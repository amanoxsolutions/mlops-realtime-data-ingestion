import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface RDISagemakerMlopsProjectCustomResourceProps {
  readonly prefix: string;
  readonly sagemakerProjectName : string;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
}

export class RDISagemakerMlopsProjectCustomResource extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly customResource: CustomResource;
  public readonly projectId: string;
  public readonly customResourceLayerArn: string;

  constructor(scope: Construct, id: string, props: RDISagemakerMlopsProjectCustomResourceProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCreateUpdateDeleteSagemakerMlopsProject'

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy;
    this.customResourceLayerArn = props.customResourceLayerArn;

    //Add policy for aws service catalog
    const serviceCatalogPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'servicecatalog:List*',
        'servicecatalog:Describe*',
        'servicecatalog:SearchProducts*',
      ],
      resources: ['*'],
    });

    const sagemakerProjectPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:CreateProject',
        'sagemaker:DescribeProject',
        'sagemaker:DeleteProject',
        'sagemaker:UpdateProject',
      ],
      resources: [`arn:aws:sagemaker:${region}:${account}:project/*`],
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

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-manage-sagemaker-project`,
      lambdaPurpose: lambdaPurpose,
      uuid: '529ab48d-3fe7-44a1-9abe-232b36c41763',
      code: Code.fromAsset('resources/lambdas/sagemaker_project'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(10),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });
    customResourceLambda.addToRolePolicy(serviceCatalogPolicy);
    customResourceLambda.addToRolePolicy(sagemakerProjectPolicy);
    customResourceLambda.addToRolePolicy(cloudWatchLogsPolicy);

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        ProjectName: props.sagemakerProjectName,
      }
    });
    this.projectId = this.customResource.getAttString('ProjectId');
  }
}

interface RDISagemakerProjectProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
}
  
export class RDISagemakerProject extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly projectName: string;
  public readonly projectId: string;

  constructor(scope: Construct, id: string, props: RDISagemakerProjectProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.projectName =  `${this.prefix}-mlops`;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime;

    //
    // Create SageMaker Project
    //
    // Create the SageMaker Studio Project using the custom resource
    const sagemakerProjectCustomResource = new RDISagemakerMlopsProjectCustomResource(this, 'Mlops', {
      prefix: this.prefix,
      sagemakerProjectName: this.projectName,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      customResourceLayerArn: props.customResourceLayerArn,
    });
    this.projectId = sagemakerProjectCustomResource.projectId;
  } 
}