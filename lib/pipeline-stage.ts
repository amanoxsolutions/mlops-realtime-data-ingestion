import { Construct } from "constructs";
import { Stage, StageProps } from 'aws-cdk-lib';
import { RealtimeDataIngestionStack } from './data-ingestion-stack';

export interface RealtimeDataIngestionStageProps extends StageProps {
  readonly prefix: string;
}

export class RealtimeDataIngestionStage extends Stage {
    
    constructor(scope: Construct, id: string, props: RealtimeDataIngestionStageProps) {
      super(scope, id, props);
  
      const realtimeDataIngestionStack = new RealtimeDataIngestionStack(this, 'RealtimeDataIngestionStack', {
        prefix: props.prefix,
      });      
    }
}