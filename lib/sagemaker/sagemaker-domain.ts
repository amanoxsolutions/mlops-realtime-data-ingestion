import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  IRole,
  ManagedPolicy,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import { CfnDomain } from 'aws-cdk-lib/aws-sagemaker';
import { RDISagemakerUser } from './sagemaker-users';
import { RDICleanupSagemakerDomain } from './sagemaker-cleanup';

interface RDISagemakerDomainProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
}

export class RDISagemakerDomain extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly role: IRole;
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly userName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerDomainProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.userName = `${this.prefix}-sagemaker-user`;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    //
    // Create SageMaker Studio Domain
    //
    // Set the domain name
    this.domainName =  `${this.prefix}-sagemaker-studio-domain`;

    // Create the IAM Role for SagMaker Studio Domain
    this.role = new Role(this, 'StudioRole', {
      roleName: `${this.prefix}-sagemaker-studio-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
    });
    this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'));
    this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess'));
    this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFeatureStoreAccess'));

    const policyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ['s3:ListBucket'],
          effect: Effect.ALLOW,
          resources: [props.dataBucketArn],
        }),
        new PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          effect: Effect.ALLOW,
          resources: [`${props.dataBucketArn}/*`],
        }),
      ],
    });
    new Policy(this, 'lambdaPolicy', {
      policyName: `${this.prefix}-sagemaker-studio-s3-access-policy`,
      document: policyDocument,
      roles: [this.role],
    });

    // Create the SageMaker Studio Domain
    const domain = new CfnDomain(this, 'StudioDomain', {
      domainName: this.domainName,
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      authMode: 'IAM',
      defaultUserSettings: {
        executionRole: this.role.roleArn,
      },
    });
    this.domainId = domain.attrDomainId;
    domain.applyRemovalPolicy(this.removalPolicy);

    // Create SageMaker User
    const sagemakerUser = new RDISagemakerUser( this, 'User', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      dataBucketArn: props.dataBucketArn,
      domainName: this.domainName, 
      domainId: this.domainId,
    });
    sagemakerUser.node.addDependency(domain);

    // Custom Resource to clean upp the SageMaker Studio Domain 
    if (this.removalPolicy === RemovalPolicy.DESTROY) {
      const cleanupSagemakerDomain = new RDICleanupSagemakerDomain(this, 'CleanupSagemakerDomain', {
        prefix: this.prefix,
        domainName: this.domainName,
        domainId: domain.attrDomainId,
        studioUserName: sagemakerUser.userName,
        studioAppName: sagemakerUser.appName,
        vpcId: props.vpcId,
      });
    }
  } 
}