import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { RDISagemakerStudio } from './sagemaker';
import { RDIFeatureStore } from './feature-store';

export interface SagemakerStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly vpc: IVpc;
}
  
export class SagemakerStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly studio: RDISagemakerStudio;
  public readonly featureStore: RDIFeatureStore;

  constructor(scope: Construct, id: string, props: SagemakerStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    this.studio = new RDISagemakerStudio(this, 'sagemakerStudio', {
      prefix: this.prefix,
      dataBucketArn: props.dataBucketArn,
      vpcId: props.vpc.vpcId,
      subnetIds: props.vpc.selectSubnets({ subnetType: SubnetType.PUBLIC }).subnetIds,
    });

    this.featureStore = new RDIFeatureStore(this, 'featureStore', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
    });
  }
}