import { Construct } from 'constructs';
import { Stack, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { RDILambda } from '../lambda';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Fail, StateMachine, StateMachineType, Succeed, IStateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import {
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Effect,
} from 'aws-cdk-lib/aws-iam';


interface RDICleanupStepFunctionProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
}

export class RDICleanupStepFunction extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly stateMachine: IStateMachine;


  constructor(scope: Construct, id: string, props: RDICleanupStepFunctionProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    //
    // Lambda Function to Cleanup the SSM Parameters
    //
    const cleanupSsmParametersPolicyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'AllowToDescribeParameters',
          actions: ['ssm:DescribeParameters'],
          resources: ['*']
        }),
        new PolicyStatement({
          sid: 'AllowToDeleteSagemakerModelParameters',
          actions: ['ssm:DeleteParameter*'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/rdi-mlops/sagemaker/model-build/*`]
        }),
        new PolicyStatement({
          sid: 'AllowToPutCloudWatchLogEvents',
          actions: [
            'logs:PutLogEvents', 
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
          ],
          resources: ['*'],
        })
      ]
    });
    const cleanupSsmParametersRole = new Role(this, 'CleanupSsmParametersRole', {
      roleName: `${this.prefix}-cleanup-ssm-parameters-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    new Policy(this, 'CleanupSsmParametersPolicy', {
      policyName: 'cleanup-ssm-parameters-policy',
      document: cleanupSsmParametersPolicyDocument,
      roles: [cleanupSsmParametersRole],
    });
    const cleanupSsmParameters = new RDILambda(this, 'CleanupSsmParametersLambda', {
      prefix: this.prefix,
      name: 'cleanup-ssm-parameters',
      codePath: 'resources/lambdas/cleanup_ssm_parameters',
      role: cleanupSsmParametersRole,
      runtime: this.runtime,
      memorySize: 256,
      timeout: Duration.seconds(30),
    });

    //
    // Create the Step Function IAM Role
    //
    const stateMachinePolicyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [cleanupSsmParameters.function.functionArn]
        })
      ]
    });
    const stateMachineRole = new Role(this, 'StateMachineRole', {
      roleName: `${this.prefix}-cleanup-sagemaker-project-role`,
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    new Policy(this, 'StateMachinePolicy', {
      policyName: 'cleanup-sagemaker-project-policy',
      document: stateMachinePolicyDocument,
      roles: [stateMachineRole],
    });

    //
    // Create the Step Function
    //
    const stepFunctionName = `${this.prefix}-cleanup-sagemaker-project`;
    const logGroup = new LogGroup(this, 'logGroup', {
      logGroupName: `/aws/step-function/${stepFunctionName}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const cleanupSsmParametersTask = new LambdaInvoke(this, 'InvokeCleanupSsmParameters', {
      lambdaFunction: cleanupSsmParameters.function,
      outputPath: '$.Payload',
    });

    const definition = cleanupSsmParametersTask

    this.stateMachine = new StateMachine(this, 'StateMachine', {
      definition,
      stateMachineName: stepFunctionName,
      role: stateMachineRole,
      timeout: Duration.minutes(20),
      stateMachineType: StateMachineType.STANDARD,
      tracingEnabled: true,
      logs: {
        destination: logGroup,
      },
    });
  }
}