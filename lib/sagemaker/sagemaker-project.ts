import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect, Role, ServicePrincipal, ArnPrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface RDISagemakerMlopsProjectCustomResourceProps {
  readonly prefix: string;
  readonly sagemakerProjectName : string;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
  readonly portfolioId : string;
  readonly domainExecutionRole: Role;
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

    // IAM policy for Service Catalog
    const serviceCatalogPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'servicecatalog:List*',
        'servicecatalog:Describe*',
        'servicecatalog:SearchProducts*',
      ],
      resources: ['*'],
    });

    // IAM Policy for SageMaker Project
    const sagemakerProjectPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:CreateProject',
        'sagemaker:DescribeProject',
        'sagemaker:DeleteProject',
        'sagemaker:UpdateProject',
      ],
      resources: [`arn:aws:sagemaker:${region}:${account}:project/${this.prefix}*`],
    });

    // IAM policy for CloudWatch Logs
    const cloudWatchLogsPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${region}:${account}:*`	],
    });

    // IAM policy to assume the SageMaker Domain Execution Role in order ot create the SageMaker Project
    const stsAssumeRolePolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sts:AssumeRole',
      ],
      resources: [props.domainExecutionRole.roleArn],
    });

    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-manage-sagemaker-project-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    singeltonRole.addToPolicy(serviceCatalogPolicy);
    singeltonRole.addToPolicy(sagemakerProjectPolicy);
    singeltonRole.addToPolicy(cloudWatchLogsPolicy);
    singeltonRole.addToPolicy(stsAssumeRolePolicy);

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-manage-sagemaker-project`,
      lambdaPurpose: lambdaPurpose,
      uuid: '529ab48d-3fe7-44a1-9abe-232b36c41763',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/sagemaker_project'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(10),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    // We also need the SageMaker domain execution role to trust the custom resource role
    props.domainExecutionRole.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        principals: [singeltonRole.grantPrincipal],
      })
    );

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        ProjectName: props.sagemakerProjectName,
        PortfolioId: props.portfolioId,
        DomainExecutionRoleArn: props.domainExecutionRole.roleArn,
        RemovalPolicy: this.removalPolicy,
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
  readonly portfolioId: string;
  readonly domainExecutionRole: Role;
}
  
export class RDISagemakerProject extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly portfolioId: string;
  public readonly projectName: string;
  public readonly projectId: string;

  constructor(scope: Construct, id: string, props: RDISagemakerProjectProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.projectName =  `${this.prefix}-mlops`;
    this.portfolioId = props.portfolioId;
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
      portfolioId : this.portfolioId,
      domainExecutionRole: props.domainExecutionRole,
    });
    this.projectId = sagemakerProjectCustomResource.projectId;
  } 
}