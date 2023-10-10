import { Construct } from 'constructs';
import { Runtime, Code, SingletonFunction, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

interface RDIStartKinesisAnalyticsProps {
    readonly prefix: string;
    readonly kinesis_analytics_name: string;
}

export class RDIStartKinesisAnalytics extends Construct {
    public readonly prefix: string;
    public readonly kinesis_analytics_name: string;

    constructor(scope: Construct, id: string, props: RDIStartKinesisAnalyticsProps) {
        super(scope, id);

        this.prefix = props.prefix;
        this.kinesis_analytics_name = props.kinesis_analytics_name;
        const region = Stack.of(this).region;
        const account = Stack.of(this).account;
        
        const customResourceLayerArn = StringParameter.fromStringParameterAttributes(this, 'CustomResourceLayerArn', {
            parameterName: `${props.prefix}-custom-resource-ARN`,
          }).stringValue
        const layer = LayerVersion.fromLayerVersionArn(this, 'layerversion', customResourceLayerArn)

        const customResourceHandler = new SingletonFunction(this, 'Singleton', {
            functionName: `${this.prefix}-start-kinesis-app`,
            lambdaPurpose: 'CustomResourceToStartKinesisApp',
            uuid: '384bbf76-66b8-11ee-8c99-0242ac120002',
            code: Code.fromAsset('resources/lambdas/start_kinesis_app'),
            handler: 'main.lambda_handler',
            timeout: Duration.minutes(5),
            runtime: Runtime.PYTHON_3_9,
            logRetention: RetentionDays.ONE_WEEK,
            environment: {
                KINESIS_ANALYTICS_NAME: this.kinesis_analytics_name,
                INPUT_STARTING_POSITION: "NOW",
            },
            layers: [layer],
        });

        const lambdaPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['kinesisanalytics:DescribeApplication', 'kinesisanalytics:StartApplication'],
            resources: [`arn:aws:kinesisanalytics:${region}:${account}:application/${this.kinesis_analytics_name}`],
        });
        customResourceHandler.addToRolePolicy(lambdaPolicyStatement);

        const provider = new Provider(this, "provider", {
            onEventHandler: customResourceHandler,
        });

        const startKinesisAnalytics = new CustomResource(this, 'StartKinesisAnalytics', {
            serviceToken: provider.serviceToken,
        });
    }

}