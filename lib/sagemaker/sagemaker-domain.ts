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
}

export class RDISagemakerDomainCustomResource extends Construct {
  public readonly customResource: CustomResource;
  public readonly domainId: string;

  constructor(scope: Construct, id: string, props: RDISagemakerDomainCustomResourceProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCreateUpdateDeleteSagemakerDomain'

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
      functionName: `${props.prefix}-manage-sagemaker-domain`,
      lambdaPurpose: lambdaPurpose,
      uuid: '61e6b537-fe77-4e73-8304-1eb3480b0867',
      code: Code.fromAsset('resources/lambdas/sagemaker_domain'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(10),
      runtime: Runtime.PYTHON_3_9,
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
        RemovalPolicy: props.removalPolicy,
      }
    });
    this.domainId = this.customResource.getAttString('DomainId');
  }
}

import { CfnWaitCondition, CfnWaitConditionHandle } from 'aws-cdk-lib/aws-cloudformation';


interface CleanupSagemakerDomainTriggerProps {
  readonly prefix: string;
  readonly stepFunctionArn: string;
  readonly sagemakerStudioDomainId: string;
  readonly sagemakerStudioUserProfile: string;
  readonly sagemakerStudioAppName: string;
  readonly cfCallbackUrl: string;
}

export class CleanupSagemakerDomainTrigger extends Construct {
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: CleanupSagemakerDomainTriggerProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToTriggerCleanupOfSageMakerDomain'

    const stateMachinePolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'states:StartExecution'
      ],
      resources: [props.stepFunctionArn],
    });

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
      functionName: `${props.prefix}-cleanup-sagemaker-domain-trigger`,
      lambdaPurpose: lambdaPurpose,
      uuid: '33b41147-8a9b-4300-856f-d5b5a3daab3e',
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_trigger'),
      handler: 'main.lambda_handler',
      timeout: Duration.seconds(30),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(stateMachinePolicy);
    customResourceLambda.addToRolePolicy(sagemakerList);
    customResourceLambda.addToRolePolicy(sagemakerDeleteApp);

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        PhysicalResourceId: lambdaPurpose,
        StepFunctionArn: props.stepFunctionArn,
        DomainId: props.sagemakerStudioDomainId,
        StudioUserProfile: props.sagemakerStudioUserProfile,
        StudioAppName: props.sagemakerStudioAppName,
        CfCallbackUrl: props.cfCallbackUrl,
      },
    });
  }
}

interface RDISagemakerStudioProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
  readonly cleanupStateMachineArn: string;
}

export class RDISagemakerStudio extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
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

    // Create the SageMaker Studio Domain using the custom resource
    const domain = new RDISagemakerDomainCustomResource(this, 'Domain', {
      prefix: this.prefix,
      sagemakerStudioDomainName: this.domainName,
      defaultUserSettingsExecutionRoleArn:  this.role.roleArn,
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      removalPolicy: this.removalPolicy,
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
      const dataHash = hash({
        prefix: this.prefix,
        ts: Date.now().toString()
      });
      // CloudFormation Wait Condition to wait to receive a signal that all the 
      // apps have been deleted
      const waitDeletionHandle = new CfnWaitConditionHandle(this, 'WaitAppDeletionHandle'.concat(dataHash));
      const cleanupDomain = new CleanupSagemakerDomainTrigger(this, 'Trigger', {
        prefix: this.prefix,
        stepFunctionArn: props.cleanupStateMachineArn,
        sagemakerStudioDomainId: this.domainId,
        sagemakerStudioUserProfile: sagemakerUser.name,
        sagemakerStudioAppName: sagemakerUser.appName,
        cfCallbackUrl: waitDeletionHandle.ref,
      });
      const waitDeletion = new CfnWaitCondition(this, 'WaitAppDeletion'.concat(dataHash), {
        count: 1,
        timeout: '1800',
        handle: waitDeletionHandle.ref,
      });
      waitDeletion.node.addDependency(cleanupDomain.customResource);
      waitDeletion.node.addDependency(sagemakerUser.studioApp);
    }
  } 
}