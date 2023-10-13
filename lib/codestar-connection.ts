import { Construct } from 'constructs';
import { Duration, CustomResource } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface CodestarConnectionProps {
    readonly prefix: string;
    readonly name: string;
    readonly runtime: Runtime;
  }
  
  export class CodestarConnection extends Construct {
    public readonly arn: string;
  
    constructor(scope: Construct, id: string, props: CodestarConnectionProps) {
      super(scope, id);

      const connectionPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['codestar-connections:ListConnections'],
        resources: ['*'],
      });

      const lambdaPurpose = 'CustomResourceToGetCodeStarConnectionArn';

      const layer = new PythonLayerVersion(this, 'Layer', {
        entry: `resources/lambdas/custom_resource_layer`,
        description: `${props.prefix}-get-codestar-connection Lambda Layer`,
        compatibleRuntimes: [props.runtime],
        layerVersionName: `${props.prefix}-get-codestar-connection-layer`,
      });

      const customResourceLambda = new SingletonFunction(this, 'Singleton', {
        functionName: `${props.prefix}-get-codestar-connection`,
        lambdaPurpose: lambdaPurpose,
        uuid: 'gx84f7l0-1rr5-88j5-3dd4-qb0be01bg0lp',
        code: Code.fromAsset('resources/lambdas/get_connection'),
        handler: 'main.lambda_handler',
        timeout: Duration.seconds(60),
        runtime: props.runtime,
        logRetention: RetentionDays.ONE_WEEK,
        layers: [layer],
      });
      customResourceLambda.addToRolePolicy(connectionPolicy);

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