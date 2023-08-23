import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { RealtimeDataIngestionStage } from './pipeline-stage';
import { CodestarConnection } from './ingestion/codestar-connection';
import { ComputeType, LinuxArmBuildImage, BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { getShortHashFromString } from './git-branch';


export interface DataIngestionPipelineStackProps extends StackProps {
  readonly prefix: string;
  readonly repoName: string;
  readonly codestarConnectionName: string;
  readonly fullBranchName: string;
  readonly shortBranchName: string;
}

export class DataIngestionPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: DataIngestionPipelineStackProps) {
    super(scope, id, props);

    // Create a unique suffix based on the AWS account number and the branchName
    // to be used for resources this is used for S3 bucket bucket names for example
    const uniqueSuffix = getShortHashFromString(`${this.account}-${props.shortBranchName}`, 8);
    console.log('unique resource Suffix source string: 👉 ', `${this.account}-${props.shortBranchName}`);
    console.log('unique resource Suffix hash: 👉 ', uniqueSuffix);

    const codestarConnection = new CodestarConnection(this, 'CsConnection', {
      prefix: props.prefix,
      name: props.codestarConnectionName
    });

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: `${props.prefix}-pipeline`,
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(props.repoName, props.fullBranchName,
          { 
            connectionArn: codestarConnection.arn,
            codeBuildCloneOutput: true,
          }
        ),
        // We pass to the CodeBuild job the branchName as a context parameter
        commands: [`git checkout ${props.fullBranchName}`, 'cat .git/HEAD', 'npm ci', 'npm run build', 'npx cdk synth']
      }),
      dockerEnabledForSynth: true,
      cliVersion: '2.92.0',
      assetPublishingCodeBuildDefaults: {
        buildEnvironment: {
          buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
          computeType: ComputeType.SMALL,
        }
      },
    });
    pipeline.node.addDependency(codestarConnection);

    pipeline.addStage(new RealtimeDataIngestionStage(this, `${props.prefix}-RealtimeDataIngestion`, {
      prefix: props.prefix,
      uniqueSuffix: uniqueSuffix,
    }));
  }
}
