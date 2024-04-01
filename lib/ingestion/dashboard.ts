import { Stack, Duration } from 'aws-cdk-lib';
import { Color, Dashboard, GraphWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface RDIIngestionPipelineDashboardProps {
  readonly prefix: string;
}

export class RDIIngestionPipelineDashboard extends Construct {
  public readonly prefix: string;
  public readonly dashboard: Dashboard;
  public readonly pipelineWidget: GraphWidget;

  constructor(scope: Construct, id: string, props: RDIIngestionPipelineDashboardProps) {
    super(scope, id);

    this.prefix = props.prefix;
    const region = Stack.of(this).region;

    this.dashboard = new Dashboard(this, 'dashboard', {
      dashboardName: `${this.prefix}-data-ingestion-pipeline`,
      start: '-PT3H',
      end: 'now',
    });

    const ingestionWorker = new Metric({
      metricName: 'IngestedDataSize',
      label: 'Amount of data in bytes ingested by the Fargate container',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'DataIngestionPipeline',
      dimensionsMap: { 
        IngestedData: 'Size',
      },
      color: Color.GREEN,
    });

    const eventBridge = new Metric({
      metricName: 'PutEventsRequestSize',
      label: 'Total amount of data in bytes written to EventBridge',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/Events',
      color: Color.BLUE,
      region: region,
    });

    const kinesisFirehoseIncomingBytes = new Metric({
      metricName: 'IncomingBytes',
      label: 'Amount of data in bytes ingested by Kinesis Firehose',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/Firehose',
      dimensionsMap: { DeliveryStreamName: `${this.prefix}-kf-stream` },
      color: Color.ORANGE,
      region: region,
    });

    const kinesisFirehoseDeliveryToS3 = new Metric({
      metricName: 'DeliveryToS3.Bytes',
      label: 'Amount of data in bytes delivered by Kinesis Firehose to S3',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/Firehose',
      dimensionsMap: { DeliveryStreamName: `${this.prefix}-kf-stream` },
      color: Color.RED,
      region: region,
    });

    this.pipelineWidget = new GraphWidget({
      title: 'Ingestion Pipeline - Data Size',
      height: 9,
      width: 12,
      left: [ingestionWorker, eventBridge, kinesisFirehoseIncomingBytes, kinesisFirehoseDeliveryToS3],
      stacked: false,
    });
    this.pipelineWidget.position(0, 0);
    this.dashboard.addWidgets(this.pipelineWidget);
  }
}
