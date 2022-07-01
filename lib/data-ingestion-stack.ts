import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RDIDynamodbTable } from './dynamodb';
import { RDIIngestionWorker } from './fargate-worker';
import { RDIIngestionWorkerImage } from './ingestion-worker-image';
import { RDILambda } from './lambda';
import { EventbridgeToKinesisFirehoseToS3 } from '@aws-solutions-constructs/aws-eventbridge-kinesisfirehose-s3';
import { EventBus } from 'aws-cdk-lib/aws-events';


export interface RealtimeDataIngestionStackProps extends StackProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly kinesisBufferInterval?: Duration;
  readonly kinesisBufferSize?: Size;
}

export class RealtimeDataIngestionStack extends Stack {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly kinesisBufferInterval: Duration;
  public readonly kinesisBufferSize : Size;

  constructor(scope: Construct, id: string, props: RealtimeDataIngestionStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.kinesisBufferInterval = props.kinesisBufferInterval || Duration.seconds(60);
    this.kinesisBufferSize = props.kinesisBufferSize || Size.mebibytes(1);

    const inputTable = new RDIDynamodbTable(this, 'inputHashTable', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });

    const lambda = new RDILambda(this, 'filterDuplicatesLambda', {
      prefix: this.prefix,
      name: 'filter-duplicates',
      codePath: 'resources/lambdas/filter_duplicates',
      memorySize: 256,
      timeout: Duration.seconds(60),
      environment: {
        DYNAMODB_SEEN_TABLE_NAME: inputTable.table.tableName,
        HASH_KEY_NAME: inputTable.table.partitionKey.name,
      }
    });

    const inputStream = new EventbridgeToKinesisFirehoseToS3(this, 'InputStream', {
      eventBusProps: { eventBusName: `${this.prefix}-ingestion-bus` },
      eventRuleProps: { 
        ruleName: `${this.prefix}-ingestion-rule`,
        eventPattern: {
          detailType: ["Incoming Data"],
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
        bucketName: `${this.prefix}-input-bucket`,
        autoDeleteObjects: true,
        removalPolicy: this.removalPolicy,
      },
      loggingBucketProps: { 
        bucketName: `${this.prefix}-logging-bucket`,
        autoDeleteObjects: true,
        removalPolicy: this.removalPolicy,
      },
    });

    let eventBusArn = EventBus.fromEventBusName(this, 'DefaultBus', 'default').eventBusArn;
    if (inputStream.eventBus) {
      eventBusArn = inputStream.eventBus.eventBusArn;
    } 

    const ingestionWorkerImage = new RDIIngestionWorkerImage(this, 'WorkerImgae', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });

    const ingestionWorker = new RDIIngestionWorker(this, 'Worker', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      eventBusArn: eventBusArn,
      ecrRepo: ingestionWorkerImage.ecrRepo,
    });
    ingestionWorker.node.addDependency(ingestionWorkerImage);
    
  }
}
