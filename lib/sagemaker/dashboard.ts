import { Stack, Duration } from 'aws-cdk-lib';
import { Color, Dashboard, GraphWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface RDIIngestionPipelineDashboardProps {
  readonly prefix: string;
  readonly dashboard: Dashboard;
  readonly flinkAppName: string;
}

export class RDIIngestionPipelineDashboard extends Construct {
  public readonly prefix: string;
  public readonly dashboard: Dashboard;
  public readonly flinkAppWidget: GraphWidget;

  constructor(scope: Construct, id: string, props: RDIIngestionPipelineDashboardProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.dashboard = props.dashboard;
    const region = Stack.of(this).region;

    // Add the Managed Service for Apache Flink input metric to the ingestion pipeline dashboard
    const flinkAppInput = new Metric({
      metricName: 'numRecordsIn',
      label: 'Number of records inngested by the Apache Flink Application',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/KinesisAnalytics',
      dimensionsMap: { 
        Id: '1.1',
        Application: props.flinkAppName,
        Flow: 'Input', 
      },
      color: Color.BLUE,
      region: region,
    });

    // Create a new widget for the output of the Managed Service for Apache Flink
    const flinkAppOutput = new Metric({
      metricName: 'numRecordsOut',
      label: 'Number of records produced by the Apache Flink Application',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/KinesisAnalytics',
      dimensionsMap: { 
        Id: '2.1',
        Application: props.flinkAppName,
        Flow: 'Output', 
      },
      color: Color.ORANGE,
      region: region,
    });
    this.flinkAppWidget = new GraphWidget({
      title: 'Ingestion Pipeline - Apache Flink Application Input/Output Records Count',
      height: 9,
      width: 12,
      left: [flinkAppInput, flinkAppOutput],
      stacked: false,
    });
    this.dashboard.addWidgets(this.flinkAppWidget);
    this.flinkAppWidget.position(12, 0);
  }
}
