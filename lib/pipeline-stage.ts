import { Construct } from "constructs";
import { Stage, StageProps } from 'aws-cdk-lib';
import { RealtimeDataIngestionStack } from './data-ingestion-stack';

export interface RealtimeDataIngestionStageProps extends StageProps {
  readonly prefix: string;
  readonly uniqueSuffix: string;
}

export class RealtimeDataIngestionStage extends Stage {
    
    constructor(scope: Construct, id: string, props: RealtimeDataIngestionStageProps) {
      super(scope, id, props);
  
      new RealtimeDataIngestionStack(this, "Stack", {
        prefix: props.prefix,
        s3Suffix: props.uniqueSuffix,
      });      
    }
}
