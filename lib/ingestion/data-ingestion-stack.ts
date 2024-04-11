import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RDIDynamodbTable } from './dynamodb';
import { RDIIngestionWorker } from './fargate-worker';
import { RDIIngestionWorkerImage } from './ingestion-worker-image';
import { RDILambda } from '../lambda';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { EventbridgeToKinesisFirehoseToS3 } from '@aws-solutions-constructs/aws-eventbridge-kinesisfirehose-s3';
import { StreamMode } from 'aws-cdk-lib/aws-kinesis';
import { EventbridgeToKinesisStreams } from '@aws-solutions-constructs/aws-eventbridge-kinesisstreams';
import { KinesisStreamsToKinesisFirehoseToS3  } from '@aws-solutions-constructs/aws-kinesisstreams-kinesisfirehose-s3';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Policy, PolicyDocument, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Dashboard, GraphWidget } from 'aws-cdk-lib/aws-cloudwatch';
import { RDIIngestionPipelineDashboard } from './dashboard';


export interface RealtimeDataIngestionStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly s3Versioning?: boolean;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
}

export class RealtimeDataIngestionStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly s3Versioning: boolean;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly vpc: IVpc;
  public readonly dashboard: Dashboard;
  public readonly pipelineWidget: GraphWidget;

  constructor(scope: Construct, id: string, props: RealtimeDataIngestionStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.s3Versioning = props.s3Versioning || false;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    const dataBucketName = `${this.prefix}-input-bucket-${this.s3Suffix}`;

    //
    // Ingestion Stream
    //
    // EventBridge -> Ingestion Kinesis Data Stream
    // Create the EventBridge to Kinesis Data Stream contruct
    const eventDetailType = 'Incoming Data';
    const ingestionStream = new EventbridgeToKinesisStreams(this, 'IngestionStream', {
      eventBusProps: { eventBusName: `${this.prefix}-ingestion-bus` },
      eventRuleProps: { 
        ruleName: `${this.prefix}-ingestion-rule`,
        eventPattern: {
          detailType: [eventDetailType],
        },
      },
      kinesisStreamProps: { 
        streamName: `${this.prefix}-kd-ingestion-stream`,
        StreamMode: StreamMode.ON_DEMAND,
      },
    });

    //
    // Delivery Stream
    //
    // Delivery Kinesis Data Stream -> Kinesis Firehose -> S3
    //                            |--> Managed Service for Apache Flink
    // Create a 2nd delivery Kinesis Data Stream with a Kinesis Firehose writing to S3 
    // The Lambda function will write the filtered data to the second Kinesis Data Stream
    const kinesisFirhoseName = `${this.prefix}-kf-stream`;
    const deliveryStream = new KinesisStreamsToKinesisFirehoseToS3(this, 'DeliveryStreamToFirehoseToS3', {
      kinesisStreamProps: {
        streamName: `${this.prefix}-kd-delivery-stream`,
        streamMode: StreamMode.ON_DEMAND,
      },
      kinesisFirehoseProps: { 
        deliveryStreamName : kinesisFirhoseName,
      },
      bucketProps: { 
        bucketName: dataBucketName,
        autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY,
        removalPolicy: this.removalPolicy,
        versioned: this.s3Versioning,
      },
      logS3AccessLogs: false,
    });

    //
    // Stream Processing
    //
    // Ingestion Kinesis Data Stream -> Lambda -> Delivery Kinesis Data Stream
    // DynamoDB table to store the seen records
    const inputTable = new RDIDynamodbTable(this, 'inputHashTable', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });
    // Get the ARN of the custom resource Lambda Layer from SSM parameter
    const customResourceLayerArn = StringParameter.fromStringParameterAttributes(this, 'CustomResourceLayerArn', {
      parameterName: '/rdi-mlops/stack-parameters/custom-resource-layer-arn',
    }).stringValue
    // Create the Lambda function used by Kinesis Firehose to pre-process the data
    const lambda = new RDILambda(this, 'streamProcessingLambda', {
      prefix: this.prefix,
      name: 'stream-processing',
      codePath: 'resources/lambdas/stream_processing',
      runtime: this.runtime,
      memorySize: 256,
      timeout: Duration.seconds(60),
      hasLayer: true,
      environment: {
        DYNAMODB_SEEN_TABLE_NAME: inputTable.table.tableName,
        HASH_KEY_NAME: inputTable.partitionKey,
        TTL_ATTRIBUTE_NAME: inputTable.timeToLiveAttribute,
        DDB_ITEM_TTL_HOURS: '3',
        KINESIS_DATASTREAM_NAME: deliveryStream.kinesisStream.streamName,
      }
    });
    // Add the PutItem permissions on the DynamoDB table to the Lambda function's policy
    const dynamodbPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [inputTable.table.tableArn],
    });
    lambda.function.addToRolePolicy(dynamodbPolicyStatement);
    // Add the PutRecord permissions on the Kinesis Data Stream to the Lambda function's policy
    const kinesisPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['kinesis:PutRecord'],
      resources: [deliveryStream.kinesisStream.streamArn],
    });
    lambda.function.addToRolePolicy(kinesisPolicyStatement);

    // Create the EventBridge to Kinesis Firehose to S3 construct
    // const inputStream = new EventbridgeToKinesisFirehoseToS3(this, 'InputStream', {
    //   eventBusProps: { eventBusName: `${this.prefix}-ingestion-bus` },
    //   eventRuleProps: { 
    //     ruleName: `${this.prefix}-ingestion-rule`,
    //     eventPattern: {
    //       detailType: [eventDetailType],
    //     },
    //   },
    //   kinesisFirehoseProps: { 
    //     deliveryStreamName : `${this.prefix}-kf-stream`,
    //     extendedS3DestinationConfiguration: {
    //       processingConfiguration: {
    //         enabled: true,
    //         processors: [{
    //           type: 'Lambda',
    //           parameters: [
    //           {
    //             parameterName: 'LambdaArn',
    //             parameterValue: lambda.function.functionArn,
    //           }
    //         ],
    //         }], 
    //       }
    //     }
    //   },
    //   bucketProps: { 
    //     bucketName: dataBucketName,
    //     autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY,
    //     removalPolicy: this.removalPolicy,
    //     versioned: this.s3Versioning,
    //   },
    //   logS3AccessLogs: false,
    // });
    
    let dataBucketArn;
    if (deliveryStream.s3Bucket) {
      dataBucketArn = deliveryStream.s3Bucket.bucketArn;
    } else {
      dataBucketArn = `arn:aws:s3:::${dataBucketName}`;
    }

    // Retrieve the eventBus data stream from the eventbridgeToKinesisFirehoseToS3 stack
    // If no custom eventBus was specified, the construct uses the default eventBus so we
    // set these values as default and get the inputStream custom eventBus if it was specified
    let eventBusArn = EventBus.fromEventBusName(this, 'DefaultBus', 'default').eventBusArn;
    let eventBusName = 'default';
    if (ingestionStream.eventBus) {
      eventBusArn = ingestionStream.eventBus.eventBusArn;
      eventBusName = ingestionStream.eventBus.eventBusName;
    } 

    const ingestionWorkerImage = new RDIIngestionWorkerImage(this, 'WorkerImage', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      customResourceLayerArn: customResourceLayerArn,
    });

    const ingestionWorker = new RDIIngestionWorker(this, 'Worker', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      ecrRepo: ingestionWorkerImage.ecrRepo,
      eventBusArn: eventBusArn,
      eventBusName: eventBusName,
      eventDetailType: eventDetailType,
      ingestionDataStreamArn: ingestionStream.kinesisStream.streamArn,
      ingestionIntervalMSec: 1000, // 1 second
    });
    ingestionWorker.node.addDependency(ingestionWorkerImage);
    this.vpc = ingestionWorker.vpc;

    new StringParameter(this, 'IngestionStreamSSMParameter', {
      parameterName: '/rdi-mlops/stack-parameters/ingestion-data-stream-arn',
      stringValue: ingestionStream.kinesisStream.streamArn,
      description: 'ARN of the ingestion Kinesis Data Stream',
    });

    new StringParameter(this, 'DeliveryStreamSSMParameter', {
      parameterName: '/rdi-mlops/stack-parameters/delivery-data-stream-arn',
      stringValue: deliveryStream.kinesisStream.streamArn,
      description: 'ARN of the delivery Kinesis Data Stream',
    });

    new StringParameter(this, 'FirehoseStreamSSMParameter', {
      parameterName: '/rdi-mlops/stack-parameters/ingestion-firehose-stream-arn',
      stringValue: deliveryStream.kinesisFirehose.attrArn,
      description: 'ARN of the ingestion Kinesis Firehose Stream',
    });

    new StringParameter(this, 'DataBucketSSMParameter', {
      parameterName: '/rdi-mlops/stack-parameters/ingestion-data-bucket-arn',
      stringValue: dataBucketArn,
      description: 'ARN of the ingestion data S3 Bucket',
    });

    // Create the dashboard
    const customDashboard = new RDIIngestionPipelineDashboard(this, 'IngestionPipelineDashboard', {
      prefix: this.prefix,
      ingestionStreamName: ingestionStream.kinesisStream.streamName,
      deliveryStreamName: deliveryStream.kinesisStream.streamName,
      firehoseStreamName: deliveryStream.kinesisFirehose.deliveryStreamName || kinesisFirhoseName,
    });
    this.dashboard = customDashboard.dashboard;
    this.pipelineWidget = customDashboard.pipelineWidget;
  }
}
