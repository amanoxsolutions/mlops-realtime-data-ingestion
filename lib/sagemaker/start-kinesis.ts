import { Construct } from 'constructs';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, Policy, PolicyDocument, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';


interface RDIStartFlinkApplicationProps {
  readonly prefix: string;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
  readonly flink_application_name: string;
}

export class RDIStartFlinkApplication extends Construct {
  public readonly prefix: string;
  public readonly runtime: Runtime;
  public readonly customResourceLayerArn: string;
  public readonly flink_application_name: string;

  constructor(scope: Construct, id: string, props: RDIStartFlinkApplicationProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.customResourceLayerArn = props.customResourceLayerArn;
    this.flink_application_name = props.flink_application_name;
    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    const policyDocument = new PolicyDocument({
      statements: [
        // IAM policy to start the Flink Application
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'kinesisanalytics:DescribeApplication', 
            'kinesisanalytics:StartApplication'
          ],
          resources: [`arn:aws:kinesisanalytics:${region}:${account}:application/${this.flink_application_name}`],
        }),
        // IAM policy for CloudWatch Logs
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
          ],
          resources: [`arn:aws:logs:${region}:${account}:*`	],
        }),
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-start-flink-app-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'lambda-cr-start-flink-app-policy': policyDocument,
      },
    });

    const customResourceHandler = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-start-flink-app`,
      lambdaPurpose: 'CustomResourceToStartFlinkApp',
      uuid: '384bbf76-66b8-11ee-8c99-0242ac120002',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/start_flink_app'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(5),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        FLINK_APPLICATION_NAME: this.flink_application_name,
      },
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    const startKinesisAnalytics = new CustomResource(this, 'Cr', {
      serviceToken: customResourceHandler.functionArn,
    });
  }
}