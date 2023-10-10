import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { RDISagemakerStudio } from './sagemaker-domain';
import { RDIFeatureStore } from './feature-store';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface SagemakerStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
}
  
export class SagemakerStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly domain: RDISagemakerStudio;
  public readonly featureStore: RDIFeatureStore;
  public readonly modelBucket: IBucket;

  constructor(scope: Construct, id: string, props: SagemakerStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // Get the necessary information of the ingestion stack from SSM parameters
    const customResourceLayerArn = StringParameter.fromStringParameterAttributes(this, 'CustomResourceLayerArn', {
      parameterName: `/${props.prefix}/stack-parameters/custom-resource-layer-arn`,
    }).stringValue

    const vpcId = StringParameter.fromStringParameterAttributes(this, 'VpcIdSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/vpc-id`,
    }).stringValue
    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId: vpcId })

    const ingestionFirehoseStreamArn = StringParameter.fromStringParameterAttributes(this, 'FirehoseStreamSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/ingestion-firehose-stream-arn`,
    }).stringValue

    const dataBucketArn = StringParameter.fromStringParameterAttributes(this, 'DataBucketSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/ingestion-data-bucket-arn`,
    }).stringValue

    // S3 bucket to store the Model artifacts
    this.modelBucket = new Bucket(this, 'ModelBucket', {
      bucketName: `${this.prefix}-sagemaker-model-artifacts-${this.s3Suffix}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy == RemovalPolicy.DESTROY,
    });

    this.domain = new RDISagemakerStudio(this, 'sagemakerStudio', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      dataBucketArn: dataBucketArn,
      modelBucetArn: this.modelBucket.bucketArn,
      vpcId: vpcId,
      subnetIds: vpc.selectSubnets({ subnetType: SubnetType.PUBLIC }).subnetIds,
      customResourceLayerArn: customResourceLayerArn,
    });

    this.featureStore = new RDIFeatureStore(this, 'featureStore', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      customResourceLayerArn: customResourceLayerArn,
      firehoseStreamArn: ingestionFirehoseStreamArn,
      s3Suffix: this.s3Suffix,
    });
  }
}