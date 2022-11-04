import { Construct } from "constructs";
import { Stage, StageProps } from 'aws-cdk-lib';
import { RealtimeDataIngestionStack } from './ingestion/data-ingestion-stack';
import { SagemakerStack } from './sagemaker/sagemaker-stack';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
export interface RealtimeDataIngestionStageProps extends StageProps {
  readonly prefix: string;
  readonly uniqueSuffix: string;
}

export class RealtimeDataIngestionStage extends Stage {
    
    constructor(scope: Construct, id: string, props: RealtimeDataIngestionStageProps) {
      super(scope, id, props);
  
      // Stack to deploy the Realtime Data Ingestion 
      const ingestionStack = new RealtimeDataIngestionStack(this, "IngestionStack", {
        prefix: props.prefix,
        s3Suffix: props.uniqueSuffix,
      });   
      
      // Stack to deploy SageMaker
    new SagemakerStack(this, "SagemakerStack", {
      prefix: props.prefix,
      s3Suffix: props.uniqueSuffix,
      dataBucketArn: ingestionStack.dataBucketArn,
      vpc: ingestionStack.vpc,
    });    
    }
}
