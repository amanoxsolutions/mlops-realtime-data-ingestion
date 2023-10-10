import hash = require('object-hash');
import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy  } from 'aws-cdk-lib';
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
import { RDISagemakerUser } from './sagemaker-users';

interface RDISagemakerDomainCustomResourceProps {
  readonly prefix: string;
  readonly sagemakerStudioDomainName: string;
  readonly defaultUserSettingsExecutionRoleArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
}

export class RDISagemakerDomainCustomResource extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly customResource: CustomResource;
  public readonly domainId: string;

  constructor(scope: Construct, id: string, props: RDISagemakerDomainCustomResourceProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCreateUpdateDeleteSagemakerDomain'

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy;

    const sagemakerManage = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:CreateDomain',
        'sagemaker:DescribeDomain',
        'sagemaker:DeleteDomain',
        'sagemaker:UpdateDomain'
      ],
      resources: [`arn:aws:sagemaker:${region}:${account}:domain/*`],
    });

    const cloudWatchLogsPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${region}:${account}:*`	],
    });

    const sagemakerExecPassRole = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'iam:PassRole',
      ],
      resources: [ props.defaultUserSettingsExecutionRoleArn	],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-manage-sagemaker-domain`,
      lambdaPurpose: lambdaPurpose,
      uuid: '61e6b537-fe77-4e73-8304-1eb3480b0867',
      code: Code.fromAsset('resources/lambdas/sagemaker_domain'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(10),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(sagemakerManage);
    customResourceLambda.addToRolePolicy(cloudWatchLogsPolicy);
    customResourceLambda.addToRolePolicy(sagemakerExecPassRole);

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        DomainName: props.sagemakerStudioDomainName,
        DefaultUserSettings: {
          ExecutionRole: props.defaultUserSettingsExecutionRoleArn,
        },
        VpcId: props.vpcId,
        SubnetIds: props.subnetIds,
        RemovalPolicy: this.removalPolicy,
      }
    });
    this.domainId = this.customResource.getAttString('DomainId');
  }
}

import { CfnWaitCondition, CfnWaitConditionHandle } from 'aws-cdk-lib/aws-cloudformation';


interface CleanupSagemakerDomainUserProps {
  readonly prefix: string;
  readonly runtime: Runtime;
  readonly sagemakerStudioDomainId: string;
  readonly sagemakerStudioUserProfile: string;
  readonly sagemakerStudioAppName: string;
}

export class CleanupSagemakerDomainUser extends Construct {
  public readonly prefix: string;
  public readonly runtime: Runtime;
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: CleanupSagemakerDomainUserProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerDomainUser'

    this.prefix = props.prefix;
    this.runtime = props.runtime;

    const sagemakerList = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:List*'
      ],
      resources: ['*'],
    });

    const sagemakerDeleteApp = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:DescribeApp',
        'sagemaker:DeleteApp'
      ],
      resources: [`arn:aws:sagemaker:${region}:${account}:app/${props.sagemakerStudioDomainId}/${props.sagemakerStudioUserProfile}/*/*`],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cleanup-sagemaker-domain-user`,
      lambdaPurpose: lambdaPurpose,
      uuid: '33b41147-8a9b-4300-856f-d5b5a3daab3e',
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_user'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(15),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(sagemakerList);
    customResourceLambda.addToRolePolicy(sagemakerDeleteApp);

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        PhysicalResourceId: lambdaPurpose,
        DomainId: props.sagemakerStudioDomainId,
        StudioUserProfile: props.sagemakerStudioUserProfile,
        StudioAppName: props.sagemakerStudioAppName,
      },
    });
  }
}

interface RDISagemakerStudioProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
  readonly dataBucketArn: string;
  readonly modelBucetArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
}

export class RDISagemakerStudio extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly role: IRole;
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly userName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerStudioProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.domainName =  `${this.prefix}-sagemaker-studio-domain`;
    this.userName = `${this.prefix}-sagemaker-studio-user`;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime;

    //
    // Create SageMaker Studio Domain
    //
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
          resources: [
            props.dataBucketArn,
            props.modelBucetArn,
          ],
        }),
        new PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          effect: Effect.ALLOW,
          resources: [
            `${props.dataBucketArn}/*`,
            `${props.modelBucetArn}/*`,
          ],
        }),
      ],
    });
    new Policy(this, 'lambdaPolicy', {
      policyName: `${this.prefix}-sagemaker-studio-s3-access-policy`,
      document: policyDocument,
      roles: [this.role],
    });

    // Create the SageMaker Studio Domain using the custom resource
    const domain = new RDISagemakerDomainCustomResource(this, 'Domain', {
      prefix: this.prefix,
      sagemakerStudioDomainName: this.domainName,
      defaultUserSettingsExecutionRoleArn:  this.role.roleArn,
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
    });
    this.domainId = domain.domainId;

    // Create SageMaker User
    const sagemakerUser = new RDISagemakerUser( this, 'User', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      dataBucketArn: props.dataBucketArn,
      domainName: this.domainName, 
      domainId: this.domainId,
      name: this.userName,
    });
    sagemakerUser.node.addDependency(domain);

    if (this.removalPolicy === RemovalPolicy.DESTROY) {
      // IMPORTANT
      // In order to delete the SageMaker Domain User, we need to delete all the apps first
      // However, deleting an app can take more than 15 minutes, the maximum timeout for a 
      // Lambda Function custom resource. The problem is that WaitConditions do not support
      // delete operations, i.e. they do not wait to receive a signal when the resource is
      // deleted. So there is currently no mechanism available to wait for the apps to be
      // deleted before deleting the user. So currently the deletion of the apps and 
      // waiting for the user to be deleted is inside the custom resource. The only thing
      // we can do is hope to get lucky and that the apps are deleted before the 15 minutes
      // timeout. If not, CloudFormation stack deletion with result in an error.
      const cleanupDomain = new CleanupSagemakerDomainUser(this, 'UserCleanup', {
        prefix: this.prefix,
        runtime: this.runtime,
        sagemakerStudioDomainId: this.domainId,
        sagemakerStudioUserProfile: sagemakerUser.name,
        sagemakerStudioAppName: sagemakerUser.appName,
      });
      cleanupDomain.node.addDependency(sagemakerUser.userProfile);
    }
  } 
}