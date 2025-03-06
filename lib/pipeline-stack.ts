import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { RealtimeDataIngestionStage } from './pipeline-stage';
import { CodestarConnection } from './codestar-connection';
import { ComputeType, LinuxArmBuildImage } from 'aws-cdk-lib/aws-codebuild';
import { Bucket, BucketAccessControl, BucketEncryption } from 'aws-cdk-lib/aws-s3'
import { getShortHashFromString } from './git-branch';
import { Runtime } from 'aws-cdk-lib/aws-lambda';


export interface DataIngestionPipelineStackProps extends StackProps {
  readonly prefix: string;
  readonly repoName: string;
  readonly codestarConnectionName: string;
  readonly fullBranchName: string;
  readonly shortBranchName: string;
  readonly runtime?: Runtime;
  readonly removalPolicy?: RemovalPolicy;
  readonly repoNameBuild: string;
  readonly repoNameDeploy: string;
  readonly repoNameMonitor: string;
}

export class DataIngestionPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: DataIngestionPipelineStackProps) {
    super(scope, id, props);

    const removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // Create a resource suffix based on the AWS account number and the
    // hash of the current account number region and the repo branch name
    // to be used for resources this is used for S3 bucket bucket names for example
    const hashSuffix = getShortHashFromString(`${this.account}-${this.region}-${props.shortBranchName}`, 8);
    const resourceSuffix = this.account.substring(0, 6).concat(hashSuffix);
    console.log('resource Suffix source string: 👉 ', `${this.account}-${props.shortBranchName}`);
    console.log('resource Suffix hash: 👉 ', resourceSuffix);

    const runtime = props.runtime || Runtime.PYTHON_3_11;

    const codestarConnection = new CodestarConnection(this, 'CsConnection', {
      prefix: props.prefix,
      name: props.codestarConnectionName,
      runtime: runtime,
    });

    // Create the code artifact S3 bucket in order to be able to set the object deletion and
    // removalPolicy
    const artifactBucket = new Bucket(this, 'ArtifactBucket', {
      bucketName: `${props.prefix}-pipeline-artifacts-${resourceSuffix}`,
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      enforceSSL: true,
    });

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: `${props.prefix}-pipeline`,
      artifactBucket: artifactBucket,
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(props.repoName, props.fullBranchName,
          {
            connectionArn: codestarConnection.arn,
            codeBuildCloneOutput: true,
          }
        ),
        // We pass to the CodeBuild job the branchName as a context parameter
        commands: [`git checkout ${props.fullBranchName}`, 'cat .git/HEAD', 'npm ci', 'npm run build', 'npx cdk synth --no-previous-parameters']
      }),
      dockerEnabledForSynth: true,
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
      resourceSuffix: resourceSuffix,
      runtime: runtime,
      removalPolicy: removalPolicy,
      repoNameBuild: props.repoNameBuild,
      repoNameDeploy: props.repoNameDeploy,
      repoNameMonitor: props.repoNameMonitor,
    }));
  }
}
