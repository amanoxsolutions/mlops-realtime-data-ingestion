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
  readonly branchName: string;
}

export class DataIngestionPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: DataIngestionPipelineStackProps) {
    super(scope, id, props);

    // Create a unique suffix based on the AWS account number and the branchName
    // to be used for resources this is used for S3 bucket bucket names for example
    const uniqueSuffix = getShortHashFromString(`${this.account}-${props.branchName}`, 8);
    console.log('unique resource Suffix source string: 👉 ', `${this.account}-${props.branchName}`);
    console.log('unique resource Suffix hash: 👉 ', uniqueSuffix);

    const codestarConnection = new CodestarConnection(this, 'CsConnection', {
      prefix: props.prefix,
      name: props.codestarConnectionName
    });

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: `${props.prefix}-pipeline`,
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(props.repoName, props.branchName,
          { 
            connectionArn: codestarConnection.arn,
            codeBuildCloneOutput: true,
          }
        ),
        // We pass to the CodeBuild job the branchName as a context parameter
        commands: [`git checkout ${props.branchName}`, 'cat .git/HEAD', 'npm ci', 'npm run build', 'npx cdk synth']
      }),
      dockerEnabledForSynth: true,
      // The Default ARM Amazon Linux 2 v2 Build image comes with Node.js 12.x which creates issues with CDK v2...
      // see: https://github.com/aws/aws-cdk/issues/20739
      cliVersion: '2.54.0',
      assetPublishingCodeBuildDefaults: {
        partialBuildSpec: BuildSpec.fromObject({
          phases: {
            install: {
              commands: ["n 16.17.1"]
            }
          }
        }),
        buildEnvironment: {
          buildImage: LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_2_0,
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
