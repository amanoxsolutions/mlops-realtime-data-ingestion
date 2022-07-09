import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { RealtimeDataIngestionStage } from './pipeline-stage';
import { CodestarConnection } from './codestar-connection';
import { getCurrentBranchName, getShortHashFromString } from './git-branch';


export interface DataIngestionPipelineStackProps extends StackProps {
  readonly prefix?: string;
  readonly repoName: string;
  readonly codestarConnectionName: string;
}

export class DataIngestionPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: DataIngestionPipelineStackProps) {
    super(scope, id, props);

    // The code deployed by the pipeline is either the one from the GitBranch passed as a CDK context
    // If not, it tries to read the current branch name from the .git/HEAD file
    let branchName = this.node.tryGetContext('branchToDeploy');
    if (branchName === undefined) {
      branchName = getCurrentBranchName() || 'unknown';
      if (branchName === 'unknown') {
        throw new Error('Could not determine the branch name to deploy from the CDK Stack paramteter nor from the local .git/HEAD file');
      }
    }
    console.log('Current branch name: 👉 ', branchName);
    // Get the first 6 characters of the hash value computed from the Git branch name
    // and use it in the prefix of all the resource names
    const branchHash = getShortHashFromString(branchName);
    console.log('Hash value computed from the branch name and used for resource names: 👉 ', branchHash);
    let prefix = `mlops-rdi-${branchHash}`;
    if (props.prefix) {
      prefix = `${props.prefix}-${branchHash}`;
    }
    // Create a unique suffix based on the AWS account number to be used for resources
    // this is used for S3 bucket bucket names for example
    const uniqueSuffix = getShortHashFromString(this.account, 8);
    console.log('unique resource Suffix: 👉 ', uniqueSuffix);

    const codestarConnection = new CodestarConnection(this, 'CsConnection', {
      prefix: prefix,
      name: props.codestarConnectionName
    });

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: `${prefix}-pipeline`,
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(
          props.repoName, 
          branchName,
          { connectionArn: codestarConnection.arn }
        ),
        // We pass to the CodeBuild job the branchName as a context parameter
        commands: ['npm ci', 'npm run build', `npx cdk synth --context branchToDeploy=${branchName}`]
      }),
      dockerEnabledForSynth: true,
    });
    pipeline.node.addDependency(codestarConnection);

    pipeline.addStage(new RealtimeDataIngestionStage(this, "Stage", {
      prefix: prefix,
      uniqueSuffix: uniqueSuffix,
    }));

  }
}
