import * as path from 'path';
import { Construct } from 'constructs';
import { Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { Effect, PolicyStatement, Role, Policy, PolicyDocument, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Repository, TagMutability, IRepository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import * as ecrdeploy from 'cdk-ecr-deployment';

// Custom Resource to clean up the ECR Repository when destroying the stack
interface cleanupEcrRepoProps {
  readonly prefix: string;
  readonly runtime: Runtime;
  readonly ecrRepositoryName: string;
  readonly ecrRepositoryArn: string;
  readonly customResourceLayerArn: string;
}

export class cleanupEcrRepo extends Construct {
  public readonly prefix: string;
  public readonly runtime: Runtime;
  public readonly ecrRepositoryName: string;
  public readonly ecrRepositoryArn: string;
  public readonly customResourceLayerArn: string;

  constructor(scope: Construct, id: string, props: cleanupEcrRepoProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.ecrRepositoryName = props.ecrRepositoryName;
    this.ecrRepositoryArn = props.ecrRepositoryArn;
    this.customResourceLayerArn = props.customResourceLayerArn;

    const lambdaPurpose = 'CustomResourceToCleanupEcrImages'

    const policyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ecr:ListImages', 'ecr:BatchDeleteImage'],
          resources: [this.ecrRepositoryArn],
        }),
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-cleanup-ecr-images-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'lambda-cr-cleanup-ecr-images-policy': policyDocument,
      },
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-cleanup-ecr-images`,
      lambdaPurpose: lambdaPurpose,
      uuid: '54gf6lx0-r58g-88j5-d44t-l40cef953pqn',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/cleanup_ecr'),
      handler: 'main.lambda_handler',
      timeout: Duration.seconds(60),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        PhysicalResourceId: lambdaPurpose,
        EcrRepositoryName: this.ecrRepositoryName,
      },
    });
  }
}

interface RDIIngestionWorkerImageProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
}

export class RDIIngestionWorkerImage extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly ecrRepo: IRepository;

  constructor(scope: Construct, id: string, props: RDIIngestionWorkerImageProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy;
    this.runtime = props.runtime;

    //
    // ECR
    //
    // Setup ECR Repository
    this.ecrRepo = new Repository(this, 'EcrRepo', {
      repositoryName: `${this.prefix}-ingestion-worker`,
      imageTagMutability: TagMutability.MUTABLE,
      imageScanOnPush: true,
      removalPolicy: this.removalPolicy,
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
        runtime: this.runtime,
        ecrRepositoryName: this.ecrRepo.repositoryName,
        ecrRepositoryArn: this.ecrRepo.repositoryArn,
        customResourceLayerArn: props.customResourceLayerArn,
      });
    }
  }
}