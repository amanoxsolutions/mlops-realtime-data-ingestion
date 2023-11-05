import { Construct } from 'constructs';
import { Duration, CustomResource } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, Policy, PolicyDocument, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface CodestarConnectionProps {
  readonly prefix: string;
  readonly name: string;
  readonly runtime: Runtime;
}
  
export class CodestarConnection extends Construct {
  public readonly prefix: string;
  public readonly arn: string;

  constructor(scope: Construct, id: string, props: CodestarConnectionProps) {
    super(scope, id);

    this.prefix = props.prefix;
    const lambdaPurpose = 'CustomResourceToGetCodeStarConnectionArn';

    const policyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['codestar-connections:ListConnections'],
          resources: ['*'],
        }),
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-get-codestar-connection-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    new Policy(this, 'LambdaPolicy', {
      policyName: `${this.prefix}-cr-get-codestar-connection-policy`,
      document: policyDocument,
      roles: [singeltonRole],
    });

    const layer = new PythonLayerVersion(this, 'Layer', {
      entry: `resources/lambdas/custom_resource_layer`,
      description: `${props.prefix}-cr-get-codestar-connection Lambda Layer`,
      compatibleRuntimes: [props.runtime],
      layerVersionName: `${props.prefix}-get-codestar-connection-layer`,
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-get-codestar-connection`,
      lambdaPurpose: lambdaPurpose,
      uuid: 'gx84f7l0-1rr5-88j5-3dd4-qb0be01bg0lp',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/get_connection'),
      handler: 'main.lambda_handler',
      timeout: Duration.seconds(60),
      runtime: props.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [layer],
    });

    const customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        PhysicalResourceId: lambdaPurpose,
        ConnectionName: props.name,
      },
    });

    this.arn = customResource.getAtt('ConnectionArn').toString();
  }
}