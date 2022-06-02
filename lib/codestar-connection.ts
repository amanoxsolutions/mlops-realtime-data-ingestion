import { Construct, } from 'constructs';
import { Duration, CustomResource } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface CodestarConnectionProps {
    readonly prefix: string;
    readonly name: string;
  }
  
  export class CodestarConnection extends Construct {
    public readonly arn: string;
  
    constructor(scope: Construct, id: string, props: CodestarConnectionProps) {
      super(scope, id);

      const connectionPolicy = new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['codestar-connections:listConnections'],
        resources: ['*'],
      });

      const customResourceLambda = new SingletonFunction(this, 'Singleton', {
        functionName: `${props.prefix}-get-codestar-connection`,
        lambdaPurpose: 'CustomResourceToGetCodeStarConnectionArn',
        uuid: 'gx84f7l0-1rr5-88j5-3dd4-qb0be01bg0lp',
        code: Code.fromAsset('resources/lambdas/get_connection'),
        handler: 'main.lambda_handler',
        environment: {
          CONNECTION_NAME: props.name,
        },
        timeout: Duration.seconds(60),
        runtime: Runtime.PYTHON_3_9,
        logRetention: RetentionDays.ONE_WEEK,
      });
      customResourceLambda.addToRolePolicy(connectionPolicy);

      const customResource = new CustomResource(this, 'Resource', {
        serviceToken: customResourceLambda.functionArn,
      });

      this.arn = customResource.getAtt('ConnectionArn').toString();
    }
  }