import { Construct } from 'constructs';
import { Stack, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { ManagedPolicy, Role, ServicePrincipal, Policy, PolicyStatement, PolicyDocument, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays, LogStream } from 'aws-cdk-lib/aws-logs';
import { Bucket, BucketAccessControl, BucketEncryption, IBucket } from 'aws-cdk-lib/aws-s3';
import { CfnFeatureGroup } from 'aws-cdk-lib/aws-sagemaker';
import { CfnApplication, CfnApplicationOutput } from 'aws-cdk-lib/aws-kinesisanalytics';
import { RDILambda } from '../lambda';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as fgConfig from '../../resources/sagemaker/featurestore/agg-fg-schema.json';
import * as sourceSchema from '../../resources/sagemaker/featurestore/source-schema.json';
import { RDIStartKinesisAnalytics } from './start-kinesis';
import { CfnTrigger, CfnJob } from 'aws-cdk-lib/aws-glue';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';


const fs = require('fs');
const path = require('path');

enum FeatureStoreTypes {
  DOUBLE  = 'Fractional',
  BIGINT = 'Integral',
  STRING = 'String',
}

interface RDIFeatureStoreProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly firehoseStreamArn: string;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
  readonly dataAccessPolicy: Policy;
}

export class RDIFeatureStore extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly featureGroupName: string;
  public readonly bucket: IBucket;
  public readonly analyticsStream: CfnApplication;
  public readonly analyticsAppName: string;

  constructor(scope: Construct, id: string, props: RDIFeatureStoreProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

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
    // Realtime ingestion with Kinesis Data Analytics
    //
    this.analyticsAppName = `${this.prefix}-analytics`;

    // Lambda Function to ingest aggregated data into SageMaker Feature Store
    // Create the Lambda function used by Kinesis Firehose to pre-process the data
    const lambda = new RDILambda(this, 'IngestIntoFetureStore', {
      prefix: this.prefix,
      name: 'analytics-to-featurestore',
      codePath: 'resources/lambdas/analytics_to_featurestore',
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

    // IAM Role for Kinesis Data Analytics
    const analyticsRole = new Role(this, 'AnalyticsRole', {
      roleName: `${this.prefix}-analytics-role`,
      assumedBy: new ServicePrincipal('kinesisanalytics.amazonaws.com'),
      inlinePolicies: {
        AnalyticsRolePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: 'LambdaPermissions',
              resources: [
                lambda.function.functionArn
              ],
              actions: [
                'lambda:InvokeFunction',
                'lambda:GetFunctionConfiguration'
              ] 
            }),
            new PolicyStatement({
              sid: 'AllowAccessToSourceStream',
              resources: [
                props.firehoseStreamArn
              ],
              actions: [
                'firehose:DescribeDeliveryStream',
                'firehose:Get*'
              ] 
            }),
            new PolicyStatement({
              sid: 'ReadEncryptedInputKinesisFirehose',
              resources: ['*'], // TODO: Put the ARN of the encryption key
              actions: [
                'kms:Decrypt'
              ],
              conditions: {
                StringEquals: {
                  'kms:ViaService': 'firehose.us-east-1.amazonaws.com'
                },
                StringLike: {
                  'kms:EncryptionContext:aws:firehose:arn': props.firehoseStreamArn
                }
              }
            }),
            new PolicyStatement({
              sid: 'AllowToPutCloudWatchLogEvents',
              resources: ['*'],
              actions: [
                'logs:PutLogEvents', 
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams'
              ] 
            })
          ]
        })
      }
    });

    // Kinesis Data Analytics Application
    this.analyticsStream = new CfnApplication(this, 'Analytics', {
      applicationName: this.analyticsAppName,
      applicationCode: fs.readFileSync(path.join(__dirname, '../../resources/kinesis/analytics.sql')).toString(),
      inputs: [
        {
          namePrefix: "SOURCE_SQL_STREAM",
          kinesisFirehoseInput: {
            resourceArn: props.firehoseStreamArn,
            roleArn: analyticsRole.roleArn,
          },
          inputParallelism: { count: 1 },
          inputSchema: {
            recordFormat: {
              recordFormatType: "JSON",
              mappingParameters: { jsonMappingParameters: { recordRowPath: "$" } }
            },
            recordEncoding: "UTF-8",
            recordColumns: sourceSchema.columns
          },
        }
      ],
    });

    const startKinesisAnalytics = new RDIStartKinesisAnalytics(this, 'StartKinesisAnalytics', {
      prefix: this.prefix,
      runtime: this.runtime,
      kinesis_analytics_name: this.analyticsAppName,
      customResourceLayerArn: props.customResourceLayerArn,
    });
    startKinesisAnalytics.node.addDependency(this.analyticsStream)

    const analyticsOutput = new CfnApplicationOutput(this, 'AnalyticsOutputs', {
      applicationName: this.analyticsAppName,
      output: {
        destinationSchema: {
          recordFormatType: 'JSON'
        },
        lambdaOutput: {
          resourceArn: lambda.function.functionArn,
          roleArn: analyticsRole.roleArn,
        },
        name: 'DESTINATION_SQL_STREAM',
      }
    });
    analyticsOutput.node.addDependency(this.analyticsStream);

    const glueAssetsBucket = new Bucket(this, 'GlueAssetsBucket', {
      bucketName: `${this.prefix}-glue-assets-${props.s3Suffix}`,
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY
    });

    const glueDeployment = new BucketDeployment(this, 'DeployGlueScript', {
      sources: [Source.asset('./resources/glue')], 
      destinationBucket: glueAssetsBucket,
      destinationKeyPrefix: 'scripts',
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
            resources: [glueAssetsBucket.bucketArn, `${glueAssetsBucket.bucketArn}/*`],
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
        scriptLocation: `s3://${glueAssetsBucket.bucketName}/scripts/FeatureStoreAggregateParquet.py`, 
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