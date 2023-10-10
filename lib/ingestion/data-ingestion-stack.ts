import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RDIDynamodbTable } from './dynamodb';
import { RDIIngestionWorker } from './fargate-worker';
import { RDIIngestionWorkerImage } from './ingestion-worker-image';
import { RDILambda } from '../lambda';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { EventbridgeToKinesisFirehoseToS3 } from '@aws-solutions-constructs/aws-eventbridge-kinesisfirehose-s3';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Policy, PolicyDocument, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';


export interface RealtimeDataIngestionStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly s3Versioning?: boolean;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
}

export class RealtimeDataIngestionStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly s3Versioning: boolean;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: RealtimeDataIngestionStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.s3Versioning = props.s3Versioning || false;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    const dataBucketName = `${this.prefix}-input-bucket-${this.s3Suffix}`;

    // Get the ARN of the custom resource Lambda Layer from SSM parameter
    const customResourceLayerArn = StringParameter.fromStringParameterAttributes(this, 'CustomResourceLayerArn', {
      parameterName: `/${props.prefix}/stack-parameters/custom-resource-layer-arn`,
    }).stringValue

    const inputTable = new RDIDynamodbTable(this, 'inputHashTable', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });

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
        bucketName: dataBucketName,
        autoDeleteObjects: this.removalPolicy == RemovalPolicy.DESTROY,
        removalPolicy: this.removalPolicy,
        versioned: this.s3Versioning,
      },
      logS3AccessLogs: false,
    });
    
    let dataBucketArn;
    if (inputStream.s3Bucket) {
      dataBucketArn = inputStream.s3Bucket.bucketArn;
    } else {
      dataBucketArn = `arn:aws:s3:::${dataBucketName}`;
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
      kinesisFirehoseArn: inputStream.kinesisFirehose.attrArn,
      ingestionIntervalMSec: 1000, // 1 second
    });
    ingestionWorker.node.addDependency(ingestionWorkerImage);
    this.vpc = ingestionWorker.vpc;

    new StringParameter(this, 'VpcIdSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/vpc-id`,
      stringValue: this.vpc.vpcId,
      description: 'VPC ID',
    });

    new StringParameter(this, 'FirehoseStreamSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/ingestion-firehose-stream-arn`,
      stringValue: inputStream.kinesisFirehose.attrArn,
      description: 'ARN of the ingestion Kinesis Firehose Stream',
    });

    new StringParameter(this, 'DataBucketSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/ingestion-data-bucket-arn`,
      stringValue: dataBucketArn,
      description: 'ARN of the ingestion data S3 Bucket',
    });
  }
}
