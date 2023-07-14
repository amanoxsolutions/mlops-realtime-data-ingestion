import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
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
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnDomain } from 'aws-cdk-lib/aws-sagemaker';
import { RDISagemakerUser } from './sagemaker-users';


interface CleanupSagemakerDomainProps {
  readonly prefix: string;
  readonly sagemakerStudioDomainId: string;
  readonly vpcId: string;
}

export class CleanupSagemakerDomain extends Construct {

  constructor(scope: Construct, id: string, props: CleanupSagemakerDomainProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerDomain'

    // SageMaker, EC2, EFS access policy
    const accessPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:Describe*',
        'sagemaker:List*',
        'ec2:Describe*',
        'ec2:RevokeSecurityGroupEgress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:DeleteSecurityGroup',
        'ec2:DeleteNetworkInterface',
        'elasticfilesystem:DescribeMountTargets',
        'elasticfilesystem:DeleteMountTarget',
        'elasticfilesystem:DeleteFileSystem',
      ],
      resources: ['*'],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${props.prefix}-cleanup-sagemaker-domain`,
      lambdaPurpose: lambdaPurpose,
      uuid: 'bdaf37bd-4318-8cde--7af6b0b23758dd1f',
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_domain'),
      handler: 'main.lambda_handler',
      environment: {
        PHYSICAL_ID: lambdaPurpose,
        SAGEMAKER_DOMAIN_ID: props.sagemakerStudioDomainId,
        VPC_ID: props.vpcId,
      },
      timeout: Duration.minutes(10),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(accessPolicy);

    new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
    });
  }
}

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
      const cleanupSagemakerDomain = new CleanupSagemakerDomain(this, 'CleanupSagemakerDomain', {
        prefix: this.prefix,
        sagemakerStudioDomainId: domain.attrDomainId,
        vpcId: props.vpcId,
      });
      cleanupSagemakerDomain.node.addDependency(domain);
      cleanupSagemakerDomain.node.addDependency(sagemakerUser);
    }
  } 
}