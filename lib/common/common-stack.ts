import { Stack, StackProps, RemovalPolicy, Duration, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';


export interface CommonResourcesStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
}

export class CommonResourcesStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;

  constructor(scope: Construct, id: string, props: CommonResourcesStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    const customResourceLayer = new PythonLayerVersion(this, 'CustomResourceLayer', {
      entry: `resources/lambdas/custom_resource_layer`,
      description: `${props.prefix}-custom-resource Lambda Layer`,
      compatibleRuntimes: [props.runtime],
      layerVersionName: `${props.prefix}-custom-resource-layer`,
    });

    new StringParameter(this, 'CustomResourceLayerSSMParameter', {
      parameterName: `/${props.prefix}/stack-parameters/custom-resource-layer-arn`,
      stringValue: customResourceLayer.layerVersionArn,
      description: 'Custom Resource Lambda Layer ARN',
    });
  }
}
