import { Construct } from 'constructs';
import { Stack, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { ManagedPolicy, Role, ServicePrincipal, Policy, PolicyStatement, PolicyDocument, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays, LogStream } from 'aws-cdk-lib/aws-logs';
import { Bucket, BucketAccessControl, BucketEncryption, IBucket } from 'aws-cdk-lib/aws-s3';
import { CfnFeatureGroup } from 'aws-cdk-lib/aws-sagemaker';
import { CfnApplication, CfnApplicationOutput } from 'aws-cdk-lib/aws-kinesisanalytics';
import { RDILambda } from '../lambda';
import * as fgConfig from '../../resources/sagemaker/agg-fg-schema.json';

const fs = require('fs');
const path = require('path');

enum FeatureStoreTypes {
  DOUBLE  = 'Fractional',
  BIGINT = 'Integral',
  STRING = 'String',
}

interface RDIFeatureStoreProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly firehoseStreamArn: string;
}

export class RDIFeatureStore extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly aggFeatureGroup: CfnFeatureGroup;
  public readonly bucket: IBucket;
  public readonly analyticsStream: CfnApplication;

  constructor(scope: Construct, id: string, props: RDIFeatureStoreProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    //
    // SageMaker Feature Store
    //
    // Create an S3 Bucket for the Offline Feature Store
    this.bucket = new Bucket(this, 'FeatureStoreBucket', {
      bucketName: `${this.prefix}-sagemaker-feature-store-bucket`,
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy == RemovalPolicy.DESTROY
    });


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
    const cfnFeatureGroup = new CfnFeatureGroup(this, 'MyCfnFeatureGroup', {
      eventTimeFeatureName: fgConfig.event_time_feature_name,
      featureDefinitions: fgConfig.features.map(
        (feature: { name: string; type: string }) => ({
          featureName: feature.name,
          featureType: FeatureStoreTypes[feature.type as keyof typeof FeatureStoreTypes],
        })
      ),
      featureGroupName: `${this.prefix}-agg-feature-group`,
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
    const analyticsAppName = `${this.prefix}-analytics`;

    // Lambda Function to ingest aggregated data into SageMaker Feature Store
    // Create the Lambda function used by Kinesis Firehose to pre-process the data
    const lambda = new RDILambda(this, 'IngestIntoFetureStore', {
      prefix: this.prefix,
      name: 'analytics-to-featurestore',
      codePath: 'resources/lambdas/analytics_to_featurestore',
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: {
        AGG_FEATURE_GROUP_NAME: cfnFeatureGroup.featureGroupName,
      }
    });

    // Add the PutItem permissions on the DynamoDB table to the Lambda function's policy
    const lambdaPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sagemaker:PutRecord'],
      resources: [`arn:aws:sagemaker:${region}:${account}:feature-group/${cfnFeatureGroup.featureGroupName}`],
    });
    lambda.function.addToRolePolicy(lambdaPolicyStatement);

    // Setup Kinesis Analytics CloudWatch Logs
    const analyticsLogGroup = new LogGroup(this, 'AnalyticsLogGroup', {
      logGroupName: analyticsAppName,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: this.removalPolicy,
    });

    const logStreamName = 'analytics-logstream'
    const analyticsLogStream = new LogStream(this, 'AnalyticsLogStream', {
      logGroup: analyticsLogGroup,
      logStreamName: logStreamName,
      removalPolicy: this.removalPolicy,
    });

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
              resources: [ 
                analyticsLogGroup.logGroupArn,
                `${analyticsLogGroup.logGroupArn}:*`,
               ],
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
      applicationName: analyticsAppName,
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
            recordColumns: [
              {
                name: "ingestion_version",
                mapping: "$.version",
                sqlType: "INTEGER"
              },
              {
                name: "ingestion_id",
                mapping: "$.id",
                sqlType: "VARCHAR(64)"
              },
              {
                name: "ingestion_detail_type",
                mapping: "$.detail-type",
                sqlType: "VARCHAR(16)"
              },
              {
                name: "ingestion_source",
                mapping: "$.source",
                sqlType: "VARCHAR(32)"
              },
              {
                name: "ingestion_account",
                mapping: "$.account",
                sqlType: "BIGINT"
              },
              {
                name: "ingestion_time",
                mapping: "$.time",
                sqlType: "VARCHAR(32)"
              },
              {
                name: "ingestion_region",
                mapping: "$.region",
                sqlType: "VARCHAR(16)"
              },
              {
                name: "ingestion_resources",
                mapping: "$.resources[0:]",
                sqlType: "VARCHAR(128)"
              },
              {
                name: "tx_hash",
                mapping: "$.detail.txs[0:].hash",
                sqlType: "VARCHAR(64)"
              },
              {
                name: "tx_ver",
                mapping: "$.detail.txs[0:].ver",
                sqlType: "INTEGER"
              },
              {
                name: "tx_vin_sz",
                mapping: "$.detail.txs[0:].vin_sz",
                sqlType: "INTEGER"
              },
              {
                name: "tx_vout_sz",
                mapping: "$.detail.txs[0:].vout_sz",
                sqlType: "INTEGER"
              },
              {
                name: "tx_size",
                mapping: "$.detail.txs[0:].size",
                sqlType: "INTEGER"
              },
              {
                name: "tx_weight",
                mapping: "$.detail.txs[0:].weight",
                sqlType: "INTEGER"
              },
              {
                name: "tx_fee",
                mapping: "$.detail.txs[0:].fee",
                sqlType: "INTEGER"
              },
              {
                name: "tx_relayed_by",
                mapping: "$.detail.txs[0:].relayed_by",
                sqlType: "VARCHAR(8)"
              },
              {
                name: "tx_lock_time",
                mapping: "$.detail.txs[0:].lock_time",
                sqlType: "INTEGER"
              },
              {
                name: "tx_index",
                mapping: "$.detail.txs[0:].tx_index",
                sqlType: "BIGINT"
              },
              {
                name: "tx_double_spend",
                mapping: "$.detail.txs[0:].double_spend",
                sqlType: "BOOLEAN"
              },
              {
                name: "tx_time",
                mapping: "$.detail.txs[0:].time",
                sqlType: "INTEGER"
              },
              {
                name: "tx_inputs",
                mapping: "$.detail.txs[0:].inputs[0:]",
                sqlType: "VARCHAR(1024)"
              },
              {
                name: "tx_out",
                mapping: "$.detail.txs[0:].out[0:]",
                sqlType: "VARCHAR(1024)"
              },
              {
                name: "tx_rbf",
                mapping: "$.detail.txs[0:].rbf",
                sqlType: "BOOLEAN"
              }
            ]
          },
        }
      ],
    });

    const analyticsOutput = new CfnApplicationOutput(this, 'AnalyticsOutputs', {
      applicationName: analyticsAppName,
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
  }
}