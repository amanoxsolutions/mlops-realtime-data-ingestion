import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { RealtimeDataIngestionStage } from './pipeline-stage';
import { CodestarConnection } from './codestar-connection';

export enum StageType {
  PROD = 'prod',
  TEST = 'test',
  DEV = 'dev',
}

export interface DataIngestionPipelineStackProps extends StackProps {
  readonly prefix: string;
  readonly repoName: string;
  readonly codestarConnectionName: string;
  readonly stage?: StageType;
}

export class DataIngestionPipelineStack extends Stack {

  constructor(scope: Construct, id: string, props: DataIngestionPipelineStackProps) {
    super(scope, id, props);

    const stage = props.stage || StageType.TEST;
    const branchName = 'main';
    if (stage == StageType.DEV) {
      const branchName = 'develop';
    }

    const codestarConnection = new CodestarConnection(this, 'CsConnection', {
      prefix: props.prefix,
      name: props.codestarConnectionName
    });

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: `${props.prefix}-${stage}-pipeline`,
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(
          props.repoName, 
          branchName,
          { connectionArn: codestarConnection.arn }
        ),
        commands: ['npm ci', 'npm run build', 'npx cdk synth']
      }),
      dockerEnabledForSynth: true,
    });
    pipeline.node.addDependency(codestarConnection);

    pipeline.addStage(new RealtimeDataIngestionStage(this, "Stage", {
      prefix: props.prefix,
    }));

  }
}
