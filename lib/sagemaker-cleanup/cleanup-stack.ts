import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RDICleanupSagemakerDomain } from './sagemaker-cleanup';

export interface SagemakerCleanupStackProps extends StackProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
}
  
export class SagemakerCleanupStack extends Stack {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: SagemakerCleanupStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    let stateMachineArn = '';
    if (this.removalPolicy === RemovalPolicy.DESTROY) {
        const cleanup = new RDICleanupSagemakerDomain(this, 'sagemakerCleanup', {
            prefix: this.prefix,
            removalPolicy: this.removalPolicy,
        });
        stateMachineArn = cleanup.stateMachineArn;
    }
    this.stateMachineArn = stateMachineArn;
  }
}