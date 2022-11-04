import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { RDISagemakerStudio } from './sagemaker';

export interface SagemakerStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy?: RemovalPolicy;
}
  
export class SagemakerStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly sagemakerStudio: RDISagemakerStudio;

  constructor(scope: Construct, id: string, props: SagemakerStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // Read values from the SSM Parameter Store
    const vpcId = StringParameter.valueForStringParameter(this, `/${this.prefix}/vpcId`);
    const dataBucketArn = StringParameter.valueForStringParameter(this, `/${this.prefix}/dataBucketArn`);
    // Import the VPC from the vpdId
    const vpc = Vpc.fromLookup(this, 'VPC', { vpcId: vpcId });

    this.sagemakerStudio = new RDISagemakerStudio(this, 'sagemakerStudio', {
      prefix: this.prefix,
      dataBucketArn: dataBucketArn,
      vpcId: vpcId,
      subnetIds: vpc.selectSubnets({ subnetType: SubnetType.PUBLIC }).subnetIds,
    });
  }
}