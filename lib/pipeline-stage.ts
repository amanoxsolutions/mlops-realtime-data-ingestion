import { Construct } from "constructs";
import { Stage, StageProps, RemovalPolicy } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { CommonResourcesStack } from "./common/common-stack";
import { RealtimeDataIngestionStack } from './ingestion/data-ingestion-stack';
import { SagemakerStack } from './sagemaker/sagemaker-stack';

export interface RealtimeDataIngestionStageProps extends StageProps {
  readonly prefix: string;
  readonly uniqueSuffix: string;
  readonly runtime: Runtime;
  readonly removalPolicy: RemovalPolicy;
}

export class RealtimeDataIngestionStage extends Stage {
    
  constructor(scope: Construct, id: string, props: RealtimeDataIngestionStageProps) {
    super(scope, id, props);

    const properties = {
      prefix: props.prefix,
      s3Suffix: props.uniqueSuffix,
      runtime: props.runtime,
      removalPolicy: props.removalPolicy,
    };

    // Stack to deploy common resources
    const customResourcesStack = new CommonResourcesStack(this, "CommonResourcesStack", properties);

    // Stack to deploy the Realtime Data Ingestion 
    const ingestionStack = new RealtimeDataIngestionStack(this, "IngestionStack", properties);
    ingestionStack.node.addDependency(customResourcesStack);

    // Stack to deploy SageMaker
    // The VPC has to be passed from stack to stack because the VPC construct can only be created
    // from an existing VPC by using the fromLookup function, passing it constants like the VPC ID
    // It can't be created using tokens which value is unknown at CLI run time
    // see: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html#static-fromwbrlookupscope-id-options
    new SagemakerStack(this, "SagemakerStack", {
      ...properties,
      vpc: ingestionStack.vpc,
      ingestionPipelineDashboard: ingestionStack.dashboard,
      ingestionPipelineWidget: ingestionStack.pipelineWidget,
    });    
  }
}
