import { Stack, Duration } from 'aws-cdk-lib';
import { Color, Dashboard, GraphWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface RDIIngestionPipelineDashboardProps {
  readonly prefix: string;
  readonly dashboard: Dashboard;
  readonly pipelineWidget: GraphWidget;
  readonly analyticsAppName: string;
}

export class RDIIngestionPipelineDashboard extends Construct {
  public readonly prefix: string;
  public readonly dashboard: Dashboard;
  public readonly pipelineWidget: GraphWidget;

  constructor(scope: Construct, id: string, props: RDIIngestionPipelineDashboardProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.dashboard = props.dashboard;
    this.pipelineWidget = props.pipelineWidget;
    const region = Stack.of(this).region;

    // Add the Kinesis Analytics input metric to the ingestion pipeline dashboard
    const kinesisAnalyticsInput = new Metric({
      metricName: 'Bytes',
      label: 'Amount of data inngested by Kinesys Analytics application',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/KinesisAnalytics',
      dimensionsMap: { 
        Id: '1.1',
        Application: props.analyticsAppName,
        Flow: 'Input', 
      },
      color: Color.PURPLE,
      region: region,
    });

    this.pipelineWidget.addLeftMetric(kinesisAnalyticsInput);

    // Create a new widget for the output of the Kinesis Analytics application
    const kinesisAnalyticsOutput = new Metric({
      metricName: 'Bytes',
      label: 'Amount of data produced by Kinesys Analytics application',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/KinesisAnalytics',
      dimensionsMap: { 
        Id: '2.1',
        Application: props.analyticsAppName,
        Flow: 'Output', 
      },
      color: Color.PURPLE,
      region: region,
    });
    const analyticsWidget = new GraphWidget({
      title: 'Ingestion Pipeline - Data Size',
      height: 9,
      width: 12,
      left: [kinesisAnalyticsOutput],
      stacked: false,
    });
    this.dashboard.addWidgets(analyticsWidget);
    analyticsWidget.position(12, 0);
  }
}
