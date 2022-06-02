import * as path from 'path';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Repository, TagMutability, IRepository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecrdeploy from 'cdk-ecr-deployment';

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
      directory: path.join(__dirname, '../resources/services/ingestion-worker'),
      
    });
    const assetDeployment = new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrdeploy.DockerImageName(ecrAsset.imageUri),
      dest: new ecrdeploy.DockerImageName(`${this.ecrRepo.repositoryUri}:latest`),
    });
  }
}