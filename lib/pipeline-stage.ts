import { Construct } from "constructs";
import { Stage, StageProps } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { CommonResourcesStack } from "./common/common-stack";
import { RealtimeDataIngestionStack } from './ingestion/data-ingestion-stack';
import { SagemakerStack } from './sagemaker/sagemaker-stack';

export interface RealtimeDataIngestionStageProps extends StageProps {
  readonly prefix: string;
  readonly uniqueSuffix: string;
  readonly runtime: Runtime;
}

export class RealtimeDataIngestionStage extends Stage {
    
  constructor(scope: Construct, id: string, props: RealtimeDataIngestionStageProps) {
    super(scope, id, props);

    const properties = {
      prefix: props.prefix,
      s3Suffix: props.uniqueSuffix,
      runtime: props.runtime,
    };

    // Stack to deploy common resources
    const customResourcesStack = new CommonResourcesStack(this, "CommonResourcesStack", properties);

    // Stack to deploy the Realtime Data Ingestion 
    const ingestionStack = new RealtimeDataIngestionStack(this, "IngestionStack", properties);
    ingestionStack.node.addDependency(customResourcesStack);

    // Stack to deploy SageMaker
    const sagemakerProperties = properties;
    new SagemakerStack(this, "SagemakerStack", {
      ...sagemakerProperties,
      vpc: ingestionStack.vpc,
    });    
  }
}
