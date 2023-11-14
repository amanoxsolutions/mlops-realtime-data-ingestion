import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, Effect, Role, Policy, PolicyDocument, ServicePrincipal, CompositePrincipal } from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface RDISagemakerMlopsProjectCustomResourceProps {
  readonly prefix: string;
  readonly resourcePrefix : string;
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
  public readonly projectName: string;
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

    const policyDocument = new PolicyDocument({
      statements: [
        // IAM policy for Service Catalog
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'servicecatalog:List*',
            'servicecatalog:Describe*',
            'servicecatalog:SearchProducts*',
          ],
          resources: ['*'],
        }),
        // IAM policy for CloudWatch Logs
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
          ],
          resources: [`arn:aws:logs:${region}:${account}:*`	],
        }),
        // IAM policy to assume the SageMaker Domain Execution Role in order ot create the SageMaker Project
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sts:AssumeRole',
          ],
          resources: [props.domainExecutionRole.roleArn],
        }),
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-manage-sagemaker-project-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    // Create the inline policy separately to avoid circular dependencies
    const singeltonPolicy = new Policy(this, 'SingeltonPolicy', {
      policyName: 'lambda-cr-manage-sagemaker-project-policy',
      document: policyDocument,
      roles: [singeltonRole],
    });

    // We also need the SageMaker domain execution role to trust the custom resource role
    props.domainExecutionRole.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        principals: [singeltonRole.grantPrincipal],
      })
    );

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-manage-sagemaker-project`,
      lambdaPurpose: lambdaPurpose,
      uuid: '529ab48d-3fe7-44a1-9abe-232b36c41763',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/sagemaker_project'),
      handler: 'main.lambda_handler',
      timeout: Duration.seconds(5),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        ResourcePrefix: props.resourcePrefix,
        PortfolioId: props.portfolioId,
        DomainExecutionRoleArn: props.domainExecutionRole.roleArn,
        RemovalPolicy: this.removalPolicy,
      }
    });
    // The policy must be created and attached to the role before creating the custom resource
    // otherwise the custom resource will fail to create
    this.customResource.node.addDependency(singeltonPolicy);
    // Get the ProjectId and ProjectName from the custom resource
    this.projectId = this.customResource.getAttString('ProjectId');
    this.projectName = this.customResource.getAttString('ProjectName');
  }
}

interface RDISagemakerProjectProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
  readonly portfolioId: string;
  readonly domainExecutionRole: Role;
  readonly dataAccessPolicy: Policy;
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

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    this.prefix = props.prefix;
    this.portfolioId = props.portfolioId;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime; 

    //
    // Create SageMaker Project
    //
    // Create the SageMaker Studio Project using the custom resource
    const sagemakerProjectCustomResource = new RDISagemakerMlopsProjectCustomResource(this, 'Mlops', {
      prefix: this.prefix,
      resourcePrefix: this.prefix,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      customResourceLayerArn: props.customResourceLayerArn,
      portfolioId : this.portfolioId,
      domainExecutionRole: props.domainExecutionRole,
    });
    this.projectId = sagemakerProjectCustomResource.projectId;
    this.projectName = sagemakerProjectCustomResource.projectName;

    // Create an IAM Policy allowing access to the SageMaker Project S3 Bucket and attach it to the data access policy
    const sagemakerProjectBucketPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        's3:ListBucket',
        's3:ListAllMyBuckets',
        's3:GetBucket*',
        's3:GetObject*', 
        's3:PutObject*', 
        's3:DeleteObject*',
      ],
      resources: [
        `arn:aws:s3:::sagemaker-project-${this.projectName}`,
        `arn:aws:s3:::sagemaker-project-${this.projectName}/*`,
      ],
    });
    props.dataAccessPolicy.addStatements(sagemakerProjectBucketPolicy);

    //
    // Custom Resources for the MLOps pipeline
    //
    // Create a custom SageMaker Processing Job role for the MLOps pipeline
    // We need to create a custom role because our processing job will need access to SageMaker Fetaure Store
    // This is a simplification of the policy of default IAM role AmazonSageMakerServiceCatalogProductsUseRole
    const basePolicyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'cloudwatch:PutMetricData',
          ],
          resources: ['*'],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'codebuild:BatchGetBuilds',
            'codebuild:StartBuild'
          ],
          resources: [
            'arn:aws:codebuild:*:*:project/sagemaker-*',
            'arn:aws:codebuild:*:*:build/sagemaker-*',
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'events:DeleteRule',
            'events:DescribeRule',
            'events:PutRule',
            'events:PutTargets',
            'events:RemoveTargets',
          ],
          resources: [
            'arn:aws:events:*:*:rule/sagemaker-*',
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'glue:BatchCreatePartition',
            'glue:BatchDeletePartition',
            'glue:BatchDeleteTable',
            'glue:BatchDeleteTableVersion',
            'glue:BatchGetPartition',
            'glue:CreateDatabase',
            'glue:CreatePartition',
            'glue:CreateTable',
            'glue:DeletePartition',
            'glue:DeleteTable',
            'glue:DeleteTableVersion',
            'glue:GetDatabase*',
            'glue:GetPartition*',
            'glue:GetTable*',
            'glue:SearchTables',
            'glue:UpdatePartition',
            'glue:UpdateTable',
            'glue:GetUserDefinedFunctions',
          ],
          resources: [
            'arn:aws:glue:*:*:catalog',
            'arn:aws:glue:*:*:database/default',
            'arn:aws:glue:*:*:database/global_temp',
            'arn:aws:glue:*:*:database/sagemaker-*',
            'arn:aws:glue:*:*:table/sagemaker-*',
            'arn:aws:glue:*:*:tableVersion/sagemaker-*',
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'athena:ListDataCatalogs',
            'athena:ListDatabases',
            'athena:ListTableMetadata',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
            'athena:StartQueryExecution',
            'athena:StopQueryExecution',
          ],
          resources: ['*'],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'logs:CreateLogDelivery',
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:DeleteLogDelivery',
            'logs:UpdateLogDelivery',
            'logs:Describe*',
            'logs:GetLog*',
            'logs:ListLogDeliveries',
            'logs:PutLogEvents',
            'logs:PutResourcePolicy',
          ],
          resources: [`arn:aws:logs:${region}:${account}:*`	],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:*',
          ],
          resources: [
            `arn:aws:sagemaker:${region}:${account}:domain/*`,
            `arn:aws:sagemaker:${region}:${account}:user-profile/*`,
            `arn:aws:sagemaker:${region}:${account}:app/*`,
            `arn:aws:sagemaker:${region}:${account}:flow-definition/*`,
          ],
        }),
      ],
    });  

    const sagemakerProcessingJobRole = new Role(this, 'SagemakerProcessingJobRole', {
      roleName: `${this.prefix}-sagemaker-processing-job-role`,
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('sagemaker.amazonaws.com'),
        new ServicePrincipal('codebuild.amazonaws.com'),
      ),
    });
    sagemakerProcessingJobRole.attachInlinePolicy(props.dataAccessPolicy);


  } 
}