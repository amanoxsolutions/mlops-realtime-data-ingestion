import { Construct } from "constructs";
import { Stage, StageProps } from 'aws-cdk-lib';
import { RealtimeDataIngestionStack } from './ingestion/data-ingestion-stack';
import { SagemakerStack } from './sagemaker/sagemaker-stack';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
export interface DeploymentStageProps extends StageProps {
  readonly prefix: string;
  readonly uniqueSuffix: string;
}

export class RealtimeDataIngestionStage extends Stage {
  readonly ingestionStack: RealtimeDataIngestionStack;
    
    constructor(scope: Construct, id: string, props: DeploymentStageProps) {
      super(scope, id, props);
  
      // Pipeline stage to deploy the Realtime Data Ingestion stack
      this.ingestionStack = new RealtimeDataIngestionStack(this, "Stack", {
        prefix: props.prefix,
        s3Suffix: props.uniqueSuffix,
      });      
    }
}

export class SagemakerStage extends Stage {
  readonly sagemakerStack: SagemakerStack;
    
  constructor(scope: Construct, id: string, props: DeploymentStageProps) {
    super(scope, id, props);

    // Pipeline stage to deploy the Sagemaker stack
    this.sagemakerStack = new SagemakerStack(this, "Stack", {
      prefix: props.prefix,
      s3Suffix: props.uniqueSuffix,
    });      
  }
}