import * as path from 'path';
import { Construct } from 'constructs';
import { Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Repository, TagMutability, IRepository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecrdeploy from 'cdk-ecr-deployment';

// Custom Resource to clean up the ECR Repository when destroying the stack
interface cleanupEcrRepoProps {
  readonly prefix: string;
  readonly ecrRepositoryName: string;
  readonly ecrRepositoryArn: string;
}

export class cleanupEcrRepo extends Construct {

  constructor(scope: Construct, id: string, props: cleanupEcrRepoProps) {
    super(scope, id);

    const connectionPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ecr:ListImages', 'ecr:BatchDeleteImage'],
      resources: [props.ecrRepositoryArn],
    });

    const lambdaPurpose = 'CustomResourceToCleanupEcrImages'

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${props.prefix}-cleanup-ecr-images`,
      lambdaPurpose: lambdaPurpose,
      uuid: '54gf6lx0-r58g-88j5-d44t-l40cef953pqn',
      code: Code.fromAsset('resources/lambdas/cleanup_ecr'),
      handler: 'main.lambda_handler',
      timeout: Duration.seconds(60),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(connectionPolicy);

    new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        PhysicalResourceId: lambdaPurpose,
        EcrRepositoryName: props.ecrRepositoryName,
      },
    });
  }
}

interface RDIIngestionWorkerImageProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
}

export class RDIIngestionWorkerImage extends Construct {
  public readonly prefix: string;
  public readonly ecrRepo: IRepository;

  constructor(scope: Construct, id: string, props: RDIIngestionWorkerImageProps) {
    super(scope, id);

    this.prefix = props.prefix;

    //
    // ECR
    //
    // Setup ECR Repository
    this.ecrRepo = new Repository(this, 'EcrRepo', {
      repositoryName: `${this.prefix}-ingestion-worker`,
      imageTagMutability: TagMutability.MUTABLE,
      imageScanOnPush: true,
      removalPolicy: props.removalPolicy,
    });
    const ecrAsset = new DockerImageAsset(this, 'IngestionWorkerImage', {
      directory: path.join(__dirname, '../../resources/services/ingestion-worker'),
      platform: Platform.LINUX_ARM64,
    });
    new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrdeploy.DockerImageName(ecrAsset.imageUri),
      dest: new ecrdeploy.DockerImageName(`${this.ecrRepo.repositoryUri}:latest`),
    });

    // Custom Resource to clean up ECR Repository
    if (props.removalPolicy === RemovalPolicy.DESTROY) {
      new cleanupEcrRepo(this, 'CleanupEcrRepo', {
        prefix: this.prefix,
        ecrRepositoryName: this.ecrRepo.repositoryName,
        ecrRepositoryArn: this.ecrRepo.repositoryArn,
      });
    }
  }
}