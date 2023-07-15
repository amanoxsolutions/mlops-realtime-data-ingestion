import hash = require('object-hash');
import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { RDILambda } from '../lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
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
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerDomainTrigger'

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

interface RDICleanupSagemakerDomainProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly domainName: string;
  readonly domainId: string;
  readonly vpcId: string;
  readonly studioUserName: string;
  readonly studioAppName: string;
}

export class RDICleanupSagemakerDomain extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly vpcId: string;
  public readonly studioUserName: string;
  public readonly studioAppName: string;

  constructor(scope: Construct, id: string, props: RDICleanupSagemakerDomainProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.domainName = props.domainName;
    this.domainId = props.domainId;
    this.vpcId = props.vpcId;
    this.studioUserName = props.studioUserName;
    this.studioAppName = props.studioAppName;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    //
    // AWS Step Function State Machine to Cleanup the SageMaker Domain
    //
    // Custom Resource to clean upp the SageMaker Studio Domain User by
    // deleting the apps which might have been created by the user
    // The SageMaker user can't be deleted if there are apps associated with it
    // All users apps must be deleted before we can delete the resources related
    // to the user app like the NSG, since we must wait for the apps ENI to be
    // deleted before we can delete the NSG
    if (this.removalPolicy === RemovalPolicy.DESTROY) {
      // Lambda function to check for the status of the deletion
      const lambdaCleanupStatus = new RDILambda(this, 'CleanupStatus', {
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
            resources: [`arn:aws:sagemaker:${region}:${account}:app/${this.domainId}/${this.studioUserName}/*/*`],
          })
        ]
      });
      // Lambda Function to delete the SageMaker domain EFS resources
      const lambdaDeleteEfs = new RDILambda(this, 'Efs', {
        prefix: this.prefix,
        name: 'cleanup-sagemaker-domain-efs',
        codePath: 'resources/lambdas/cleanup_sagemaker_efs',
        memorySize: 256,
        timeout: Duration.minutes(10),
        environment: {
          SAGEMAKER_DOMAIN_ID: this.domainId,
          VPC_ID: this.vpcId,
        },
        additionalPolicyStatements: [
          new PolicyStatement({
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
          })
        ]
      });
      // Lambda function to send a response to CloudFormation stack
      const lambdaCleanupResponse = new RDILambda(this, 'CleanupResponse', {
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
      const cleanupEfs = new LambdaInvoke(this, 'Delete the SageMaker domain EFS resources', {
        lambdaFunction: lambdaDeleteEfs.function,
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
        .otherwise(cleanupEfs.next(sendResponse.next(success))));
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
      const cleanupDomain = new CleanupSagemakerDomainTrigger(this, 'CleanupDomain', {
        prefix: this.prefix,
        stepFunctionArn: stateMachine.stateMachineArn,
        sagemakerStudioDomainId: this.domainId,
        sagemakerStudioUserProfile: this.studioUserName,
        sagemakerStudioAppName: this.studioAppName,
        cfCallbackUrl: waitDeletionHandle.ref,
      });
      const waitDeletion = new CfnWaitCondition(this, 'WaitAppDeletion'.concat(dataHash), {
        count: 1,
        timeout: '1800',
        handle: waitDeletionHandle.ref,
      });
      waitDeletion.node.addDependency(cleanupDomain.customResource);

    }
  } 
}