import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IParameter, StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface RDIParametersProps extends StackProps {
  readonly prefix: string;
  readonly name: string;
  readonly value: string;
}

export class RDIParameters extends Construct {
  public readonly prefix: string;
  public readonly name: string;
  public readonly param: IParameter;

  constructor(scope: Construct, id: string, props: RDIParametersProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.name = props.name;

    this.param = new StringParameter(this, this.name, {
      parameterName: `/${this.prefix}/${this.name}`,
      stringValue: props.value,
    });
  }
}