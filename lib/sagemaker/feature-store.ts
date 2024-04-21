import { Construct } from 'constructs';
import { Stack, RemovalPolicy, Duration, Fn } from 'aws-cdk-lib';
import { ManagedPolicy, Role, ServicePrincipal, Policy, PolicyStatement, PolicyDocument, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays, LogStream } from 'aws-cdk-lib/aws-logs';
import { Bucket, BucketAccessControl, BucketEncryption, IBucket } from 'aws-cdk-lib/aws-s3';
import { CfnFeatureGroup } from 'aws-cdk-lib/aws-sagemaker';
import { Application, IApplication, ApplicationCode, Runtime as FlinkRuntime } from '@aws-cdk/aws-kinesisanalytics-flink-alpha';
import { RDILambda } from '../lambda';
import { Runtime as LambdaRuntime } from 'aws-cdk-lib/aws-lambda';
import * as fgConfig from '../../resources/sagemaker/featurestore/agg-fg-schema.json';
import { RDIStartFlinkApplication } from './start-kinesis';
import { StreamMode, IStream } from 'aws-cdk-lib/aws-kinesis';
import { KinesisStreamsToLambda } from '@aws-solutions-constructs/aws-kinesisstreams-lambda';
import { CfnTrigger, CfnJob } from 'aws-cdk-lib/aws-glue';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Hash, createHash } from 'crypto';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

// Create a function to compute the hash of all the files in a directory.
// This will be used to conditionally update the Flink application when the code changes.
// from: https://stackoverflow.com/questions/68074935/hash-of-folders-in-nodejs
export function computeDirectoryHash(paths: string[], inputHash?:Hash): string {
  const hash = inputHash ? inputHash : createHash("sha1");
  for (const path of paths) {
    const statInfo = statSync(path);
    if (statInfo.isDirectory()) {
      const directoryEntries = readdirSync(path, { withFileTypes: true });
      const fullPaths = directoryEntries.map((e) => join(path, e.name));
      // recursively walk sub-folders
      computeDirectoryHash(fullPaths, hash);
    } else {
      // Compute the hash string of the file
      const content = readFileSync(path);
      hash.update(content);
    }
  }
  // if not being called recursively, get the digest and return it as the hash result
  if (!inputHash) {
    return hash.digest().toString("base64");
  }
  return '';
}

enum FeatureStoreTypes {
  DOUBLE  = 'Fractional',
  BIGINT = 'Integral',
  STRING = 'String',
}

interface RDIFeatureStoreProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly ingestionDataStreamArn: string;
  readonly ingestionDataStreamName: string;
  readonly runtime: LambdaRuntime;
  readonly customResourceLayerArn: string;
  readonly dataAccessPolicy: Policy;
}

export class RDIFeatureStore extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: LambdaRuntime;
  public readonly featureGroupName: string;
  public readonly bucket: IBucket;
  public readonly flinkApp: IApplication;
  public readonly flinkAppName: string;
  public readonly deliveryStream: IStream;
  public readonly deliveryStreamName: string;

  constructor(scope: Construct, id: string, props: RDIFeatureStoreProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    //
    // S3 Bucket to store application (Glue, Flink) code assets
    //
    const codeAssetsBucket = new Bucket(this, 'codeAssetsBucket', {
      bucketName: `${this.prefix}-app-code-assets-${props.s3Suffix}`,
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY
    });
    // Deploy the Glue script to the code assets bucket
    const glueDeployment = new BucketDeployment(this, 'DeployGlueScript', {
      sources: [Source.asset('./resources/glue')], 
      destinationBucket: codeAssetsBucket,
      destinationKeyPrefix: 'glue-scripts',
    });
    // ZIP the Flink code and deploy it to the code assets bucket
    const flinkAppAsset = new BucketDeployment(this, 'FlinkCodeAsset', {
      sources: [Source.asset('./resources/flink')],
      destinationBucket: codeAssetsBucket,
      destinationKeyPrefix: 'flink-app',
      memoryLimit: 512,
      extract: false,
    });
    const flinkAssetObejctKey = Fn.select(0, flinkAppAsset.objectKeys);
    // Create a hash of the Flink code asset to use as the version
    const flinkAssetHash = computeDirectoryHash([`./resources/flink`]);

    //
    // SageMaker Feature Store
    //
    // Create an S3 Bucket for the Offline Feature Store
    this.bucket = new Bucket(this, 'FeatureStoreBucket', {
      bucketName: `${this.prefix}-sagemaker-feature-store-bucket-${props.s3Suffix}`,
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY,
    });

    // Create an IAM Policy allowing access to the SageMaker Project S3 Bucket and attach it to the data access policy
    const featurestoreBucketPolicy = new PolicyStatement({
      sid: 'FeatureStoreBucketPolicy',
      effect: Effect.ALLOW,
      actions: [
        's3:ListBucket',
        's3:ListAllMyBuckets',
        's3:GetBucket*',
        's3:GetObject*', 
        's3:PutObject*', 
        's3:DeleteObject*',
      ],
      resources: [
        this.bucket.bucketArn,
        `${this.bucket.bucketArn}/*`,
      ],
    });
    props.dataAccessPolicy.addStatements(featurestoreBucketPolicy);


    // Create the IAM Role for Feature Store
    const fgRole = new Role(this, 'FeatureStoreRole', {
      roleName: `${this.prefix}-sagemaker-feature-store-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')],
    });
    fgRole.attachInlinePolicy(new Policy(this, 'FeatureStorePolicy', {
      policyName: `${this.prefix}-sagemaker-feature-store-s3-bucket-access`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              's3:GetObject', 
              's3:PutObject', 
              's3:DeleteObject', 
              's3:AbortMultipartUpload', 
              's3:GetBucketAcl', 
              's3:PutObjectAcl'
            ],
            resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
          }),
        ],
      })
    }));

    // Create the Feature Group
    this.featureGroupName = `${this.prefix}-agg-feature-group`;
    const cfnFeatureGroup = new CfnFeatureGroup(this, 'FeatureGroup', {
      eventTimeFeatureName: fgConfig.event_time_feature_name,
      featureDefinitions: fgConfig.features.map(
        (feature: { name: string; type: string }) => ({
          featureName: feature.name,
          featureType: FeatureStoreTypes[feature.type as keyof typeof FeatureStoreTypes],
        })
      ),
      featureGroupName: this.featureGroupName ,
      recordIdentifierFeatureName: fgConfig.record_identifier_feature_name,
    
      // the properties below are optional
      description: fgConfig.description,
      offlineStoreConfig: {
        S3StorageConfig: {
          S3Uri: this.bucket.s3UrlForObject()
        }
      },
      onlineStoreConfig: {'EnableOnlineStore': true},
      roleArn: fgRole.roleArn,
    });

    //
    // Kinesis Data Stream Sink for Apache Flink Application
    //
    // Lambda Function to ingest aggregated data into SageMaker Feature Store
    // Create the Lambda function used by the delivery Kinesis Data Stream to pre-process the data
    const lambda = new RDILambda(this, 'IngestIntoFetureStore', {
      prefix: this.prefix,
      name: 'delivery-stream-to-featurestore',
      codePath: 'resources/lambdas/delivery_stream_to_featurestore',
      runtime: this.runtime,
      memorySize: 512,
      timeout: Duration.seconds(60),
      hasLayer: true,
      environment: {
        AGG_FEATURE_GROUP_NAME: cfnFeatureGroup.featureGroupName,
      },
    });

    // Add the PutItem permissions on the DynamoDB table to the Lambda function's policy
    const lambdaPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sagemaker:PutRecord'],
      resources: [`arn:aws:sagemaker:${region}:${account}:feature-group/${cfnFeatureGroup.featureGroupName}`],
    });
    lambda.function.addToRolePolicy(lambdaPolicyStatement);

    // Create the Kinesis Data Stream Sink for the Apache Flink Application with the Lambda function as the consumer
    this.deliveryStreamName = `${this.prefix}-kd-delivery-stream`;
    const deliveryStream = new KinesisStreamsToLambda(this, 'DeliveryStream', {
      existingLambdaObj: lambda.function,
      kinesisStreamProps: {
        streamName: this.deliveryStreamName,
        streamMode: StreamMode.PROVISIONED,
        shardCount: 1,
      },
      deploySqsDlqQueue: false,
    });
    this.deliveryStream = deliveryStream.kinesisStream;

    //
    // Realtime ingestion with Kinesis Data Analytics
    //
    this.flinkAppName = `${this.prefix}-flink-app`;
    // Setup the CloudWatch Log Group
    const flinkAppLogGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/kinesis-analytics/${this.flinkAppName}`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // IAM Role for Managed Service for Apache Flink
    const flinkAppRole = new Role(this, 'MsafRole', {
      roleName: `${this.prefix}-flink-role`,
      assumedBy: new ServicePrincipal('kinesisanalytics.amazonaws.com'),
      inlinePolicies: {
        AnalyticsRolePolicy: new PolicyDocument({
          statements: [
            // https://docs.aws.amazon.com/kinesisanalytics/latest/dev/iam-role.html
            new PolicyStatement({
              sid: 'ReadInputStream',
              resources: [
                props.ingestionDataStreamArn,
              ],
              actions: [
                'kinesis:DescribeStream',
                'kinesis:GetRecords',
                'kinesis:GetShardIterator',
                'kinesis:ListShards',
              ]
            }),
            new PolicyStatement({
              sid: 'WriteOutputStream',
              resources: [
                deliveryStream.kinesisStream.streamArn
              ],
              actions: [
                'kinesis:DescribeStream',
                'kinesis:PutRecord',
                'kinesis:PutRecords',
              ]
            }),
            new PolicyStatement({
              sid: 'AllowToPutCloudWatchLogEvents',
              resources: [flinkAppLogGroup.logGroupArn],
              actions: [
                'logs:PutLogEvents', 
                'logs:CreateLogStream',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams'
              ] 
            })
          ]
        })
      }
    });

    //Managed Service for Apache Flink Application
    this.flinkApp = new Application(this, 'FlinkApp', {
      applicationName: this.flinkAppName,
      code: ApplicationCode.fromBucket(codeAssetsBucket, `flink-app/${flinkAssetObejctKey}`),
      runtime: FlinkRuntime.FLINK_1_18,
      role: flinkAppRole,
      logGroup: flinkAppLogGroup,
      snapshotsEnabled: false,
      propertyGroups: {
        'kinesis.analytics.flink.run.options': {
          python: 'main.py',
          jarfile: 'lib/flink-sql-connector-kinesis-4.2.0-1.18.jar'
        },
        'consumer.config.0': {
          'input.stream.name': props.ingestionDataStreamName,
          'aws.region': region,
          'scan.stream.initpos': 'TRIM_HORIZON',
        },
        'producer.config.0': {
          'output.stream.name': deliveryStream.kinesisStream.streamName,
          'aws.region': region,
        },
        meta: {
          // force to update the resoruce when code is modified in the ./resources/flink directory
          hash: flinkAssetHash,
        }
      },
    });

    const startFlinkApplication = new RDIStartFlinkApplication(this, 'StartFlinkApp', {
      prefix: this.prefix,
      runtime: this.runtime,
      flink_application_name: this.flinkApp.applicationName,
      customResourceLayerArn: props.customResourceLayerArn,
    });

    const glueRole = new Role(this, 'GlueRole', {
      roleName: `${this.prefix}-glue-role`,
      assumedBy:  new ServicePrincipal("glue.amazonaws.com"),
    });
    glueRole.attachInlinePolicy(new Policy(this, 'GluePolicy', {
      policyName: `${this.prefix}-glue-job-s3-bucket-access`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
            actions: [
              "s3:PutObject",
              "s3:GetObject",
              "s3:ListBucket",
              "s3:DeleteObject"
            ] 
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            resources: [codeAssetsBucket.bucketArn, `${codeAssetsBucket.bucketArn}/*`],
            actions: [
              "s3:GetObject",
              "s3:ListBucket"
            ] 
          })
        ]
      })
    }));

    const glueJob = new CfnJob(this, 'GlueJob', {
      name: `${this.prefix}-glue-job`,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${codeAssetsBucket.bucketName}/glue-scripts/FeatureStoreAggregateParquet.py`, 
      },
      role: glueRole.roleName,
      glueVersion: '4.0',
      timeout: 60,
      defaultArguments: {
        "--s3_bucket_name": this.bucket.bucketName,
        "--prefix": `${account}/sagemaker/${region}/offline-store/`,
        "--target_file_size_in_bytes": 536870912,
      }
    });
    glueJob.node.addDependency(glueDeployment)

    const glueTrigger = new CfnTrigger(this, "GlueTrigger", {
      name: `${this.prefix}-glue-trigger`,
      actions: [{
        jobName: glueJob.name,
        timeout: 60,
      }],
      type: 'SCHEDULED',
      schedule: 'cron(0 0/1 * * ? *)',
      description: 'Aggregate parquet files in SageMaker Feature Store',
      startOnCreation: true,
    });
  }
}