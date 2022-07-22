import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { RealtimeDataIngestionStage } from './pipeline-stage';
import { CodestarConnection } from './codestar-connection';
import {  getShortHashFromString } from './git-branch';


export interface DataIngestionPipelineStackProps extends StackProps {
  readonly prefix?: string;
  readonly repoName: string;
  readonly codestarConnectionName: string;
  readonly branchName: string;
}

export class DataIngestionPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: DataIngestionPipelineStackProps) {
    super(scope, id, props);

    // Get the fist 4 characters of the Git branch name (e.g. 'main', 'test', 'feat')
    // add to it the first 6 characters of the hash value computed from the Git branch name
    // and use that in the prefix of all the resource names
    const branchHash = getShortHashFromString(props.branchName);
    console.log('Hash value computed from the branch name and used for resource names: 👉 ', branchHash);
    let prefix = `mlops-rdi-${props.branchName.substring(0,4)}${branchHash}`;
    if (props.prefix) {
      prefix = `${props.prefix}-${props.branchName.substring(0,4)}${branchHash}`;
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
    });
    pipeline.node.addDependency(codestarConnection);

    pipeline.addStage(new RealtimeDataIngestionStage(this, "Stage", {
      prefix: prefix,
      uniqueSuffix: uniqueSuffix,
    }));

  }
}
