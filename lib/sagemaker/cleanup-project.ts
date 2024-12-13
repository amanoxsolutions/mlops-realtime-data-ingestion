import { Construct } from 'constructs';
import { Stack, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { RDILambda } from '../lambda';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StateMachine, StateMachineType, IStateMachine, Choice, Condition, DefinitionBody } from 'aws-cdk-lib/aws-stepfunctions';
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
  readonly sagemakerProjectBucketArn: string;
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
    const cleanupPolicyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'AllowToDescribeParameters',
          actions: ['ssm:DescribeParameters'],
          resources: ['*']
        }),
        new PolicyStatement({
          sid: 'AllowToGetSagemakerStackParameters',
          actions: ['ssm:GetParameter*'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/rdi-mlops/stack-parameters/*`]
        }),
        new PolicyStatement({
          sid: 'AllowToDeleteSagemakerModelParameters',
          actions: ['ssm:DeleteParameter*'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/rdi-mlops/sagemaker/model-build/*`]
        }),
        new PolicyStatement({
          sid: 'AllowToListSagemakerResources',
          actions: [
            'sagemaker:List*',
            'sagemaker:Describe*'
          ],
          resources: ['*']
        }),
        new PolicyStatement({
          sid: 'AllowToDeleteSagemakerResources',
          actions: [
            'sagemaker:Delete*',
            'sagemaker:DisassociateTrialComponent',
          ],
          resources: [
            `arn:aws:sagemaker:${region}:${account}:training-job/deepar-tuning*`,
            `arn:aws:sagemaker:${region}:${account}:hyper-parameter-tuning-job/deepar-tuning*`,
            `arn:aws:sagemaker:${region}:${account}:pipeline/${this.prefix}*`,
            `arn:aws:sagemaker:${region}:${account}:pipeline/sagemaker-model-monitoring*`,
            `arn:aws:sagemaker:${region}:${account}:pipeline/blockchainforecastpipeline*`,
            `arn:aws:sagemaker:${region}:${account}:pipeline/modelmonitordataingestion*`,
            `arn:aws:sagemaker:${region}:${account}:model/*`,
            `arn:aws:sagemaker:${region}:${account}:model-package/*`,
            `arn:aws:sagemaker:${region}:${account}:model-package-group/*`,
            `arn:aws:sagemaker:${region}:${account}:experiment-trial-component/*`,
            `arn:aws:sagemaker:${region}:${account}:experiment-trial/*`,
            `arn:aws:sagemaker:${region}:${account}:experiment/*`,
          ]
        }),
        new PolicyStatement({
          sid: 'DeleteS3Objects',
          actions: [
            's3:ListBucket',
            's3:GetBucketVersioning',
            's3:DeleteObject*',
          ],
          resources: [
            props.sagemakerProjectBucketArn,
            `${props.sagemakerProjectBucketArn}/*`]
        }),
        new PolicyStatement({
          sid: 'DeleteS3Bucket',
          actions: [
            's3:DeleteBucket',
          ],
          resources: [props.sagemakerProjectBucketArn]
        }),
        new PolicyStatement({
          sid: 'AllowToPutCloudWatchLogEvents',
          actions: [
            'logs:PutLogEvents',
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
          ],
          resources: ['*'],
        })
      ]
    });
    const cleanupRole = new Role(this, 'CleanupSsmParametersRole', {
      roleName: `${this.prefix}-cleanup-sagemaker-project-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    new Policy(this, 'CleanupSsmParametersPolicy', {
      policyName: 'cleanup-sagemaker-project-policy',
      document: cleanupPolicyDocument,
      roles: [cleanupRole],
    });

    //
    // Lambda Functions
    //
    // Lambda Function to cleanup SSM parameters
    const cleanupSsmParameters = new RDILambda(this, 'CleanupSsmParametersLambda', {
      prefix: this.prefix,
      name: 'cleanup-ssm-parameters',
      codePath: 'resources/lambdas/cleanup_ssm_parameters',
      role: cleanupRole,
      runtime: this.runtime,
      memorySize: 256,
      timeout: Duration.seconds(30),
      hasLayer: true,
    });
    // Lambda function to cleanup SageMaker Experiment Trials
    const cleanupSagemakerTrials = new RDILambda(this, 'CleanupSagemakerTrialsLambda', {
      prefix: this.prefix,
      name: 'cleanup-sagemaker-trials',
      codePath: 'resources/lambdas/cleanup_sagemaker_trials',
      role: cleanupRole,
      runtime: this.runtime,
      memorySize: 512,
      timeout: Duration.minutes(15),
      hasLayer: true,
    });
    // Lambda function to cleanup the SageMaker Experiments
    const cleanupSagemakerExperiments = new RDILambda(this, 'CleanupSagemakerExperimentsLambda', {
      prefix: this.prefix,
      name: 'cleanup-sagemaker-experiments',
      codePath: 'resources/lambdas/cleanup_sagemaker_experiments',
      role: cleanupRole,
      runtime: this.runtime,
      memorySize: 512,
      timeout: Duration.minutes(5),
      hasLayer: true,
    });
    // Lambda Function to cleanup SageMaker Models
    const cleanupSagemakerModels = new RDILambda(this, 'CleanupSagemakerModelsLambda', {
      prefix: this.prefix,
      name: 'cleanup-sagemaker-models',
      codePath: 'resources/lambdas/cleanup_sagemaker_models',
      role: cleanupRole,
      runtime: this.runtime,
      memorySize: 256,
      timeout: Duration.minutes(15),
      hasLayer: true,
    });
    // Lambda Function to cleanup SageMaker Pipelines
    const cleanupSagemakerPipelines = new RDILambda(this, 'CleanupSagemakerPipelinesLambda', {
      prefix: this.prefix,
      name: 'cleanup-sagemaker-pipelines',
      codePath: 'resources/lambdas/cleanup_sagemaker_pipelines',
      role: cleanupRole,
      runtime: this.runtime,
      memorySize: 256,
      timeout: Duration.minutes(15),
      hasLayer: true,
    });
    // Lambda Functio to cleanup the SageMaker Project Bucket
    const cleanupSagemakerProjectBucket = new RDILambda(this, 'CleanupSagemakerProjectBucketLambda', {
      prefix: this.prefix,
      name: 'cleanup-sagemaker-project-bucket',
      codePath: 'resources/lambdas/cleanup_sagemaker_project_bucket',
      role: cleanupRole,
      runtime: this.runtime,
      memorySize: 256,
      timeout: Duration.minutes(15),
      hasLayer: true,
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
      roleName: `${this.prefix}-cleanup-sagemaker-project-role-statemachine`,
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
    const cleanupSagemakerTrialsTask = new LambdaInvoke(this, 'InvokeCleanupSagemakerTrials', {
      lambdaFunction: cleanupSagemakerTrials.function,
      outputPath: '$.Payload',
    });
    const cleanupSagemakerExperimentsTask = new LambdaInvoke(this, 'InvokeCleanupSagemakerExperiments', {
      lambdaFunction: cleanupSagemakerExperiments.function,
      outputPath: '$.Payload',
    });
    const cleanupSagemakerModelsTask = new LambdaInvoke(this, 'InvokeCleanupSagemakerModels', {
      lambdaFunction: cleanupSagemakerModels.function,
      outputPath: '$.Payload',
    });
    const cleanupSagemakerPipelinesTask = new LambdaInvoke(this, 'InvokeCleanupSagemakerPipelines', {
      lambdaFunction: cleanupSagemakerPipelines.function,
      outputPath: '$.Payload',
    });
    const cleanupSagemakerProjectBucketTask = new LambdaInvoke(this, 'InvokeCleanupSagemakerProjectBucket', {
      lambdaFunction: cleanupSagemakerProjectBucket.function,
      outputPath: '$.Payload',
    });

    const definition = cleanupSagemakerTrialsTask
      .next(
        new Choice(this, 'MoreTrialsToCleanup')
          .when(Condition.booleanEquals('$.more_trials', true), cleanupSagemakerTrialsTask)
          .otherwise(
            cleanupSagemakerExperimentsTask
            .next(cleanupSagemakerModelsTask)
            .next(cleanupSagemakerPipelinesTask)
            .next(cleanupSagemakerProjectBucketTask)
            .next(cleanupSsmParametersTask)
          )
      );

    this.stateMachine = new StateMachine(this, 'StateMachine', {
      stateMachineName: stepFunctionName,
      definitionBody: DefinitionBody.fromChainable(definition),
      role: stateMachineRole,
      timeout: Duration.minutes(600),
      stateMachineType: StateMachineType.STANDARD,
      tracingEnabled: true,
      logs: {
        destination: logGroup,
      },
    });
  }
}
