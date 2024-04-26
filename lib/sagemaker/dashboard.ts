import { Stack, Duration } from 'aws-cdk-lib';
import { Color, Dashboard, GraphWidget, Metric } from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface RDIIngestionPipelineDashboardProps {
  readonly prefix: string;
  readonly dashboard: Dashboard;
  readonly flinkAppName: string;
  readonly deliveryStreamName: string;
}

export class RDIIngestionPipelineDashboard extends Construct {
  public readonly prefix: string;
  public readonly dashboard: Dashboard;
  public readonly flinkAppWidget: GraphWidget;
  public readonly deliveryStreamWidget: GraphWidget;

  constructor(scope: Construct, id: string, props: RDIIngestionPipelineDashboardProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.dashboard = props.dashboard;
    const region = Stack.of(this).region;

    //
    // Apache Flink Application dashboard
    //
    // Get the input and output metrics of the Managed Service for Apache Flink application
    const flinkAppInput = new Metric({
      metricName: 'numRecordsInPerSecond',
      label: 'Number of records ingested by the Apache Flink Application producer',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/KinesisAnalytics',
      dimensionsMap: { Application: props.flinkAppName },
      color: Color.BLUE,
      region: region,
    });
    const flinkAppOutput = new Metric({
      metricName: 'numRecordsOutPerSecond',
      label: 'Number of records output by the Apache Flink Application consumer',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/KinesisAnalytics',
      dimensionsMap: { Application: props.flinkAppName },
      color: Color.ORANGE,
      region: region,
    });
     // Create a new widget for the metrics of the Managed Service for Apache Flink application
    this.flinkAppWidget = new GraphWidget({
      title: 'Ingestion Pipeline - Apache Flink Application Input/Output Records Count',
      height: 9,
      width: 18,
      left: [flinkAppInput, flinkAppOutput],
      stacked: false,
    });
    this.dashboard.addWidgets(this.flinkAppWidget);
    this.flinkAppWidget.position(0, 9);

    //
    // Delivery Stream dashboard
    //
    // Get the input metric of the Kinesis Data Firehose delivery stream
    const deliveryStreamInput = new Metric({
      metricName: 'IncomingBytes',
      label: 'Amount of data in bytes ingested by the delivery Kinesis Data Stream',
      statistic: 'Sum',
      period: Duration.minutes(5),
      namespace: 'AWS/Kinesis',
      dimensionsMap: { StreamName: props.deliveryStreamName },
      color: Color.BLUE,
      region: region,
    });
    this.deliveryStreamWidget = new GraphWidget({
      title: 'Ingestion Pipeline - Delivery Stream Data Size',
      height: 9,
      width: 18,
      left: [deliveryStreamInput],
      stacked: false,
    });
    this.dashboard.addWidgets(this.deliveryStreamWidget);
    this.flinkAppWidget.position(0, 18);
  }
}
