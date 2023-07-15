import hash = require('object-hash');
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
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { RDILambda } from '../lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnUserProfile, CfnApp } from 'aws-cdk-lib/aws-sagemaker';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import {
  StateMachine,
  StateMachineType,
  Wait,
  WaitTime,
  Choice,
  Condition,
  Succeed
} from 'aws-cdk-lib/aws-stepfunctions';
import { CfnWaitCondition, CfnWaitConditionHandle } from 'aws-cdk-lib/aws-cloudformation';


interface CleanupSagemakerUserTriggerProps {
  readonly prefix: string;
  readonly stepFunctionArn: string;
  readonly sagemakerStudioDomainId: string;
  readonly sagemakerStudioUserProfile: string;
  readonly sagemakerStudioAppName: string;
  readonly cfCallbackUrl: string;
}

export class CleanupSagemakerUserTrigger extends Construct {
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: CleanupSagemakerUserTriggerProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerUserTrigger'

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
      functionName: `${props.prefix}-cleanup-sagemaker-user-trigger`,
      lambdaPurpose: lambdaPurpose,
      uuid: '33b41147-8a9b-4300-856f-d5b5a3daab3e',
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_trigger'),
      handler: 'main.lambda_handler',
      environment: {
        PHYSICAL_ID: lambdaPurpose,
        STEP_FUNCTION_ARN: props.stepFunctionArn,
        SAGEMAKER_DOMAIN_ID: props.sagemakerStudioDomainId,
        SAGEMAKER_USER_PROFILE: props.sagemakerStudioUserProfile,
        SAGEMAKER_APP_NAME: props.sagemakerStudioAppName,
        CF_CALLBACK_URL: props.cfCallbackUrl,
      },
      timeout: Duration.seconds(30),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(stateMachinePolicy);
    customResourceLambda.addToRolePolicy(sagemakerList);
    customResourceLambda.addToRolePolicy(sagemakerDeleteApp);

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
    });
  }
}

interface RDISagemakerUserProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly domainName: string;
  readonly domainId: string;
}

export class RDISagemakerUser extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly role: IRole;
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly userName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerUserProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.domainName = props.domainName;
    this.domainId = props.domainId;
    this.userName = `${this.prefix}-sagemaker-user`;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // 
    // Create a SageMaker Studio user Role
    //
    const userRole = new Role(this, 'Role', {
      roleName: `${this.prefix}-sagemaker-user-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess')
      ],
    });
    // Add access to raw data bucket
    userRole.attachInlinePolicy(new Policy(this, 'Policy', {
      policyName: `${this.prefix}-ingestion-bucket-access`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              's3:ListBucket', 
              's3:GetObject*', 
              's3:PutObject*', 
              's3:DeleteObject', 
              's3:DeleteObjectVersion', 
            ],
            resources: [props.dataBucketArn, `${props.dataBucketArn}/*`],
          }),
        ],
      })
    }));

    // Create the user profile
    const studioUser = new CfnUserProfile(this, 'Profile', {
      domainId: this.domainId,
      userProfileName: this.userName,
      userSettings: {
        executionRole: userRole.roleArn,
      },
    });
    // Add removal policy to the user profile
    studioUser.applyRemovalPolicy(this.removalPolicy);

    // Create an app for the SageMaker studio user
    const studioApp = new CfnApp(this, 'App', {
      appName: `${this.prefix}-sagemaker-user-app`,
      appType: 'JupyterServer',
      domainId: this.domainId,
      userProfileName: studioUser.userProfileName,
    });
    // Force dependency on the user profile
    studioApp.node.addDependency(studioUser);
    // add removal policy to the app
    studioApp.applyRemovalPolicy(this.removalPolicy);

    //
    // AWS Step Function State Machine to Cleanup the SageMaker Users
    //
    // Custom Resource to clean upp the SageMaker Studio Domain User by
    // deleting the apps which might have been created by the user
    // The SageMaker user can't be deleted if there are apps associated with it
    if (this.removalPolicy === RemovalPolicy.DESTROY) {
      // Lambda function to check for the status of the deletion
      const lambdaCleanupStatus = new RDILambda(this, 'CleaupStatus', {
        prefix: this.prefix,
        name: 'cleanup-sagemaker-user-status',
        codePath: 'resources/lambdas/cleanup_sagemaker_status',
        memorySize: 256,
        timeout: Duration.seconds(15),
        additionalPolicyStatements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'sagemaker:DescribeApp'
            ],
            resources: [`arn:aws:sagemaker:${region}:${account}:app/${this.domainId}/${studioUser.userProfileName}/*/*`],
          })
        ]
      });
      // Lambda function to send a response to CloudFormation stack
      const lambdaCleanupResponse = new RDILambda(this, 'CleaupResponse', {
        prefix: this.prefix,
        name: 'cleanup-sagemaker-user-response',
        codePath: 'resources/lambdas/cleanup_sagemaker_response',
        memorySize: 256,
        timeout: Duration.seconds(15),
      });
      // State Machine to delete the SageMaker Studio User
      // And wait for resources to be deleted
      //
      // Create the CloudWatch Logs group for the state machine
      const cleanupStateMachineLogGroup = new LogGroup(this, 'LogGroup', {
        logGroupName: `/aws/step-function/${this.prefix}-sagemaker-domain-user-app-cleanup`,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      // State Machine steps
      const checkStatus = new LambdaInvoke(this, 'Check the SageMaker User App Cleanup Status', {
        lambdaFunction: lambdaCleanupStatus.function,
        payloadResponseOnly: true
      });
      const sendResponse = new LambdaInvoke(this, 'Send the Response to CloudFormation', {
        lambdaFunction: lambdaCleanupResponse.function,
        payloadResponseOnly: true
      });
      checkStatus.addCatch(sendResponse, {
        errors: ['States.ALL'],
        resultPath: '$.error'
      });
      const wait = new Wait(this, 'wait', { time: WaitTime.duration(Duration.seconds(60))});
      const success = new Succeed(this, 'Deletion Finished');
      // State Machine Definition
      const smDefinition = checkStatus.next(new Choice(this, 'Is the SageMaker User App Cleanup finished?')
        .when(Condition.stringEquals('$.status', 'DELETING'), wait.next(checkStatus))
        .otherwise(sendResponse.next(success)));
      // Create the State Machine based on the definition
      const stateMachine = new StateMachine(this, 'CleanupProcess', {
        definition: smDefinition,
        stateMachineName: `${this.prefix}-sagemaker-domain-user-app-cleanup`,
        timeout: Duration.minutes(30),
        stateMachineType: StateMachineType.STANDARD,
        logs: {
          destination: cleanupStateMachineLogGroup,
        },
      });

      const dataHash = hash({
        prefix: this.prefix,
        ts: Date.now().toString()
      });
      
      // CloudFormation Wait Condition to wait to receive a signal that all the 
      // apps have been deleted
      const waitDeletionHandle = new CfnWaitConditionHandle(this, 'WaitAppDeletionHandle'.concat(dataHash));
      const cleanupUser = new CleanupSagemakerUserTrigger(this, 'CleanupUser', {
        prefix: this.prefix,
        stepFunctionArn: stateMachine.stateMachineArn,
        sagemakerStudioDomainId: this.domainId,
        sagemakerStudioUserProfile: studioUser.userProfileName,
        sagemakerStudioAppName: studioApp.appName,
        cfCallbackUrl: waitDeletionHandle.ref,
      });
      const waitDeletion = new CfnWaitCondition(this, 'WaitAppDeletion'.concat(dataHash), {
        count: 1,
        timeout: '1800',
        handle: waitDeletionHandle.ref,
      });
      waitDeletion.node.addDependency(cleanupUser.customResource);

    }
  } 
}