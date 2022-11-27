import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RDIDynamodbTable } from './dynamodb';
import { RDIIngestionWorker } from './fargate-worker';
import { RDIIngestionWorkerImage } from './ingestion-worker-image';
import { RDILambda } from '../lambda';
import { EventbridgeToKinesisFirehoseToS3 } from '@aws-solutions-constructs/aws-eventbridge-kinesisfirehose-s3';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Policy, PolicyDocument, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IVpc } from 'aws-cdk-lib/aws-ec2';


export interface RealtimeDataIngestionStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly s3Versioning?: boolean;
  readonly removalPolicy?: RemovalPolicy;
  readonly firehoseBufferInterval?: Duration;
  readonly firehoseBufferSize?: Size;
}

export class RealtimeDataIngestionStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly s3Versioning: boolean;
  public readonly removalPolicy: RemovalPolicy;
  public readonly firehoseStreamArn: string;
  public readonly firehoseBufferInterval: Duration;
  public readonly firehoseBufferSize : Size;
  public readonly dataBucketName : string;
  public readonly dataBucketArn : string;
  public readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: RealtimeDataIngestionStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.s3Versioning = props.s3Versioning || false;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.firehoseBufferInterval = props.firehoseBufferInterval || Duration.seconds(60);
    this.firehoseBufferSize = props.firehoseBufferSize || Size.mebibytes(1);
    this.dataBucketName = `${this.prefix}-input-bucket-${this.s3Suffix}`;

    const inputTable = new RDIDynamodbTable(this, 'inputHashTable', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });

    // Create the Lambda function used by Kinesis Firehose to pre-process the data
    const lambda = new RDILambda(this, 'streamProcessingLambda', {
      prefix: this.prefix,
      name: 'stream-processing',
      codePath: 'resources/lambdas/stream_processing',
      memorySize: 256,
      timeout: Duration.seconds(60),
      environment: {
        DYNAMODB_SEEN_TABLE_NAME: inputTable.table.tableName,
        HASH_KEY_NAME: inputTable.partitionKey,
        TTL_ATTRIBUTE_NAME: inputTable.timeToLiveAttribute,
        DDB_ITEM_TTL_HOURS: '3',
      }
    });

    // Add the PutItem permissions on the DynamoDB table to the Lambda function's policy
    const lambdaPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [inputTable.table.tableArn],
    });
    lambda.function.addToRolePolicy(lambdaPolicyStatement);

    // Create the EventBridge to Kinesis Firehose to S3 construct
    const eventDetailType = 'Incoming Data';
    const inputStream = new EventbridgeToKinesisFirehoseToS3(this, 'InputStream', {
      eventBusProps: { eventBusName: `${this.prefix}-ingestion-bus` },
      eventRuleProps: { 
        ruleName: `${this.prefix}-ingestion-rule`,
        eventPattern: {
          detailType: [eventDetailType],
        },
      },
      kinesisFirehoseProps: { 
        deliveryStreamName : `${this.prefix}-kf-stream`,
        extendedS3DestinationConfiguration: {
          processingConfiguration: {
            enabled: true,
            processors: [{
              type: 'Lambda',
              parameters: [
              {
                parameterName: 'LambdaArn',
                parameterValue: lambda.function.functionArn,
              }
            ],
            }], 
          }
        }
      },
      bucketProps: { 
        bucketName: this.dataBucketName,
        autoDeleteObjects: true,
        removalPolicy: this.removalPolicy,
        versioned: this.s3Versioning,
      },
      logS3AccessLogs: false,
    });
    this.firehoseStreamArn = inputStream.kinesisFirehose.attrArn;
    
    if (inputStream.s3Bucket) {
      this.dataBucketArn = inputStream.s3Bucket.bucketArn;
    } else {
      `arn:aws:s3:::${this.dataBucketName}`;
    }

    // Edit Kinesis Firehose Stream Role to allow invocation of Lambda
    const kinesisFirehoseStreamRole = inputStream.kinesisFirehoseRole;
    kinesisFirehoseStreamRole.attachInlinePolicy(new Policy(this, 'InvokeDataProcessingLambda', {
      policyName: `${this.prefix}-invoke-data-processing-lambda-policy`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['lambda:InvokeFunction', 'lambda:GetFunctionConfiguration'],
            resources: [`${lambda.function.functionArn}*`],
          }),
        ],
      })
    }));

    // Retrieve the eventBus data stream from the eventbridgeToKinesisFirehoseToS3 stack
    // If no custom eventBus was specified, the construct uses the default eventBus so we
    // set these values as default and get the inputStream custom eventBus if it was specified
    let eventBusArn = EventBus.fromEventBusName(this, 'DefaultBus', 'default').eventBusArn;
    let eventBusName = 'default';
    if (inputStream.eventBus) {
      eventBusArn = inputStream.eventBus.eventBusArn;
      eventBusName = inputStream.eventBus.eventBusName;
    } 

    const ingestionWorkerImage = new RDIIngestionWorkerImage(this, 'WorkerImage', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });

    const ingestionWorker = new RDIIngestionWorker(this, 'Worker', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      ecrRepo: ingestionWorkerImage.ecrRepo,
      eventBusArn: eventBusArn,
      eventBusName: eventBusName,
      eventDetailType: eventDetailType,
      kinesisFirehoseArn: inputStream.kinesisFirehose.attrArn,
      ingestionIntervalMSec: 1000, // 1 second
    });
    ingestionWorker.node.addDependency(ingestionWorkerImage);
    this.vpc = ingestionWorker.vpc;
    
  }
}
