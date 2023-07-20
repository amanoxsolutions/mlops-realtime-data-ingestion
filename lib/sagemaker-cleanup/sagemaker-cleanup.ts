import { Construct } from 'constructs';
import { Stack, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { RDILambda } from '../lambda';
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


interface RDICleanupSagemakerDomainProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
}

export class RDICleanupSagemakerDomain extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: RDICleanupSagemakerDomainProps) {
    super(scope, id);

    this.prefix = props.prefix;
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
      const lambdaCleanupStatus = new RDILambda(this, 'Status', {
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
            resources: [`arn:aws:sagemaker:${region}:${account}:app/*/*/*/*`],
          })
        ]
      });
      // Lambda function to send a response to CloudFormation stack
      const lambdaCleanupResponse = new RDILambda(this, 'Response', {
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
      const stateMachine = new StateMachine(this, 'Process', {
        definition: smDefinition,
        stateMachineName: `${this.prefix}-sagemaker-domain-user-app-cleanup`,
        timeout: Duration.minutes(30),
        stateMachineType: StateMachineType.STANDARD,
        logs: {
          destination: cleanupStateMachineLogGroup,
        },
      });
      this.stateMachineArn = stateMachine.stateMachineArn;
    }
  } 
}