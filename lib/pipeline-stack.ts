import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { RealtimeDataIngestionStage } from './pipeline-stage';
import { CodestarConnection } from './ingestion/codestar-connection';
import { ComputeType, LinuxArmBuildImage, BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { getShortHashFromString } from './git-branch';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';


export interface DataIngestionPipelineStackProps extends StackProps {
  readonly prefix: string;
  readonly repoName: string;
  readonly codestarConnectionName: string;
  readonly fullBranchName: string;
  readonly shortBranchName: string;
  readonly customResourceLayerRuntime: Runtime;
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

    const customResourceLayer = new PythonLayerVersion(this, 'CustomResourceLayer', {
      entry: `resources/lambdas/custom_resource_layer`,
      description: `${props.prefix}-custom-resource Lambda Layer`,
      compatibleRuntimes: [props.customResourceLayerRuntime],
      layerVersionName: `${props.prefix}-custom-resource-layer`,
    })

    const customResourceLayerSSMParameter = new StringParameter(this, 'CustomResourceLayerSSMParameter', {
      parameterName: `${props.prefix}-custom-resource-ARN`,
      stringValue: customResourceLayer.layerVersionArn,
      description: 'Custom Resource Lambda Layer ARN',
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
      cliVersion: '2.99.1',
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
