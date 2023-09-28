import { Construct } from 'constructs';
import { RDILambda } from '../lambda';
import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

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

        const customResourceHandler = new RDILambda(this, 'customResourceHandler', {
            prefix: this.prefix,
            name: 'start-kinesis-app',
            codePath: 'resources/lambdas/start_kinesis_app',
            timeout: Duration.seconds(30),
            hasLayer: true,
            environment: {
                KINESIS_ANALYTICS_NAME: this.kinesis_analytics_name,
                INPUT_STARTING_POSITION: "NOW",
            }
        });

        const lambdaPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['kinesisanalytics:DescribeApplication', 'kinesisanalytics:StartApplication', 'kinesisanalytics:StopApplication'],
            resources: [`arn:aws:kinesisanalytics:${region}:${account}:application/${this.kinesis_analytics_name}`],
        });
        customResourceHandler.function.addToRolePolicy(lambdaPolicyStatement);

        const provider = new Provider(this, "provider", {
            onEventHandler: customResourceHandler.function,
        });

        const startKinesisAnalytics = new CustomResource(this, 'StartKinesisAnalytics', {
            serviceToken: provider.serviceToken,
        });
    }

}