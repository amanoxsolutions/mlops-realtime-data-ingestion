import {Construct} from 'constructs';
import {CustomResource, Duration, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {
  Effect,
  ManagedPolicy,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {Code, Runtime, SingletonFunction} from 'aws-cdk-lib/aws-lambda';
import {PythonLayerVersion} from '@aws-cdk/aws-lambda-python-alpha';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import {CfnUserProfile} from 'aws-cdk-lib/aws-sagemaker';


interface RDISagemakerServiceCataloRolesProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
}

export class RDISagemakerServiceCataloRoles extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly customResource: CustomResource;
  public readonly customResourceLayerArn: string;
  public readonly serviceCatalagProductsLaunchRoleName: string;
  public readonly serviceCatalogProductsUseRoleName: string;
  public readonly serviceCatalagProductsExecutionRoleName: string;
  public readonly serviceCatalogProductsCodePipelineRoleName: string;
  public readonly serviceCatalogProductsCodeBuildRoleName: string;
  public readonly serviceCatalogProductsCloudFormationRoleName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerServiceCataloRolesProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCreateUpdateDeleteSagemakerDomain'

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy;
    this.customResourceLayerArn = props.customResourceLayerArn;

    const iamPolicyDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'iam:GetRole',
            'iam:CreateRole',
            'iam:UpdateRole',
            'iam:CreateServiceLinkedRole',
            'iam:UpdateServiceLinkedRole',
            'iam:PutRolePolicy',
            'iam:DeleteRolePolicy',
            'iam:AttachRolePolicy'
          ],
          resources: [`arn:aws:iam::${account}:role/*`],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'iam:CreatePolicy',
            'iam:UpdatePolicy',
            'iam:DeletePolicy',
          ],
          resources: [`arn:aws:iam::${account}:policy/${this.prefix}*`],
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
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-sagemaker-service-catalog-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    const singeltonPolicy = new Policy(this, 'SingeltonPolicy', {
      policyName: 'lambda-cr-sagemaker-service-catalog-policy',
      document: iamPolicyDocument,
      roles: [singeltonRole],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-sagemaker-service-catalog-roles`,
      lambdaPurpose: lambdaPurpose,
      uuid: '7a9e8df1-faa7-4b63-9e74-62a99d443267',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/service_catalog_roles'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(1),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        Account: account,
        StackPrefix: this.prefix,
      }
    });
    // The policy must be created and attached to the role before creating the custom resource
    // otherwise the custom resource will fail to create
    this.customResource.node.addDependency(singeltonPolicy);
    // Get the ARNs of the roles from the custom resource output
    this.serviceCatalagProductsLaunchRoleName = this.customResource.getAttString('ServiceCatalogProductsLaunchRoleName');
    this.serviceCatalogProductsUseRoleName = this.customResource.getAttString('ServiceCatalogProductsUseRoleName');
    this.serviceCatalagProductsExecutionRoleName = this.customResource.getAttString('ServiceCatalogProductsExecutionRoleName');
    this.serviceCatalogProductsCodePipelineRoleName = this.customResource.getAttString('ServiceCatalogProductsCodePipelineRoleName');
    this.serviceCatalogProductsCodeBuildRoleName = this.customResource.getAttString('ServiceCatalogProductsCodeBuildRoleName');
    this.serviceCatalogProductsCloudFormationRoleName = this.customResource.getAttString('ServiceCatalogProductsCloudFormationRoleName');
  }
}

interface RDISagemakerDomainCustomResourceProps {
  readonly prefix: string;
  readonly sagemakerStudioDomainName: string;
  readonly defaultUserSettingsExecutionRoleArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
}

export class RDISagemakerDomainCustomResource extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly customResource: CustomResource;
  public readonly domainId: string;
  public readonly portfolioId: string;
  public readonly customResourceLayerArn: string;
  public readonly eventBridgeSchedulerRole: Role;

  constructor(scope: Construct, id: string, props: RDISagemakerDomainCustomResourceProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCreateUpdateDeleteSagemakerDomain'

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy;
    this.customResourceLayerArn = props.customResourceLayerArn;

    const eventBridgeDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:StartPipelineExecution'
          ],
          resources: [`arn:aws:sagemaker:${region}:${account}:pipeline/*`],
        }),
      ],
    });

    this.eventBridgeSchedulerRole = new Role(this, 'EventBridgeSchedulerRole', {
      roleName: `${this.prefix}-eventbridge-scheduler-role`,
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    new Policy(this, 'EventBridgeSchedulerPolicy', {
      policyName: 'eventbridge-scheduler-policy',
      document: eventBridgeDocument,
      roles: [this.eventBridgeSchedulerRole],
    });

    const policyDocument = new PolicyDocument({
      statements: [
        // IAM Policy for SageMaker Domain
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:CreateDomain',
            'sagemaker:DescribeDomain',
            'sagemaker:DeleteDomain',
            'sagemaker:UpdateDomain',
          ],
          resources: [`arn:aws:sagemaker:${region}:${account}:domain/*`],
        }),
        // IAM Policy for SageMaker Service Catalog Portfolio
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:EnableSagemakerServicecatalogPortfolio',
            'sagemaker:GetSagemakerServicecatalogPortfolioStatus',
          ],
          resources: ['*'],
        }),
        // IAM policy for Service Catalog
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'servicecatalog:ListAcceptedPortfolioShares',
            'servicecatalog:AcceptPortfolioShare',
            'servicecatalog:AssociatePrincipalWithPortfolio',
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
        // IAM policy for IAM
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'iam:GetRole',
            'iam:PassRole',
          ],
          resources: [ props.defaultUserSettingsExecutionRoleArn ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'iam:CreateServiceLinkedRole',
            'iam:UpdateServiceLinkedRole',
          ],
          resources: [`arn:aws:iam::${account}:role/*`],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'iam:AttachRolePolicy',
            'iam:PutRolePolicy',
          ],
          resources: [`arn:aws:iam::${account}:role/*`],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'iam:CreatePolicy',
          ],
          resources: [`arn:aws:iam::${account}:policy/${this.prefix}*`],
        }),
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-manage-sagemaker-domain-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    const singeltonPolicy = new Policy(this, 'SingeltonPolicy', {
      policyName: 'lambda-cr-manage-sagemaker-domain-policy',
      document: policyDocument,
      roles: [singeltonRole],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-manage-sagemaker-domain`,
      lambdaPurpose: lambdaPurpose,
      uuid: '61e6b537-fe77-4e73-8304-1eb3480b0867',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/sagemaker_domain'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(15),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        DomainName: props.sagemakerStudioDomainName,
        DefaultUserSettings: {
          ExecutionRole: props.defaultUserSettingsExecutionRoleArn,
          StudioWebPortal: 'ENABLED'
        },
        VpcId: props.vpcId,
        SubnetIds: props.subnetIds,
        RemovalPolicy: this.removalPolicy,
        Account: account,
        StackPrefix: this.prefix,
      }
    });
    // The policy must be created and attached to the role before creating the custom resource
    // otherwise the custom resource will fail to create
    this.customResource.node.addDependency(singeltonPolicy);
    // Get the DomainId and PortfolioId from the custom resource output
    this.domainId = this.customResource.getAttString('DomainId');
    this.portfolioId = this.customResource.getAttString('PortfolioId');
  }
}


interface CleanupSagemakerDomainUserProps {
  readonly prefix: string;
  readonly runtime: Runtime;
  readonly customResourceLayerArn: string;
  readonly sagemakerStudioDomainId: string;
  readonly sagemakerStudioUserProfile: string;
}

export class CleanupSagemakerDomainUser extends Construct {
  public readonly prefix: string;
  public readonly runtime: Runtime;
  public readonly customResource: CustomResource;
  public readonly customResourceLayerArn: string;

  constructor(scope: Construct, id: string, props: CleanupSagemakerDomainUserProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerDomainUser'

    this.prefix = props.prefix;
    this.runtime = props.runtime;
    this.customResourceLayerArn = props.customResourceLayerArn;

    const policyDocument = new PolicyDocument({
      statements: [
        // IAM Policies for SageMaker Studio
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:List*'
          ],
          resources: ['*'],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:DescribeApp',
            'sagemaker:DeleteApp'
          ],
          resources: [`arn:aws:sagemaker:${region}:${account}:app/${props.sagemakerStudioDomainId}/${props.sagemakerStudioUserProfile}/*/*`],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:DescribeSpace',
            'sagemaker:DeleteSpace',
          ],
          resources: [`arn:aws:sagemaker:${region}:${account}:space/*`],
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
      ],
    });

    // Create the role for the custom resource Lambda
    // We do this manually to be able to give it a human readable name
    const singeltonRole = new Role(this, 'SingeltonRole', {
      roleName: `${this.prefix}-cr-cleanup-sagemaker-domain-user-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    // Create the inline policy separatly to avoid circular dependencies
    const singeltonPolicy = new Policy(this, 'SingeltonPolicy', {
      policyName: 'lambda-cr-cleanup-sagemaker-domain-user-policy',
      document: policyDocument,
      roles: [singeltonRole],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${this.prefix}-cr-cleanup-sagemaker-domain-user`,
      lambdaPurpose: lambdaPurpose,
      uuid: '33b41147-8a9b-4300-856f-d5b5a3daab3e',
      role: singeltonRole,
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_user'),
      handler: 'main.lambda_handler',
      timeout: Duration.minutes(15),
      runtime: this.runtime,
      logRetention: RetentionDays.ONE_WEEK,
      layers: [PythonLayerVersion.fromLayerVersionArn(this, 'layerversion', this.customResourceLayerArn)],
    });

    this.customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
      properties: {
        PhysicalResourceId: lambdaPurpose,
        DomainId: props.sagemakerStudioDomainId,
        StudioUserProfile: props.sagemakerStudioUserProfile,
      },
    });
    // The policy must be created and attached to the role before creating the custom resource
    // otherwise the custom resource will fail to create
    this.customResource.node.addDependency(singeltonPolicy);
  }
}

interface RDISagemakerStudioProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly runtime: Runtime;
  readonly dataBucketArn: string;
  readonly experimentBucketArn: string;
  readonly dataAccessPolicy: Policy;
  readonly monitoringJobPolicy: Policy;
  readonly vpcId: string;
  readonly subnetIds: string[];
  readonly customResourceLayerArn: string;
}

export class RDISagemakerStudio extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly executionRole: Role;
  public readonly cloudFormationRoleName: string
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly portfolioId: string;
  public readonly userName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerStudioProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.domainName =  `${this.prefix}-sagemaker-studio-domain`;
    this.userName = `${this.prefix}-sagemaker-studio-user`;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.runtime = props.runtime;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    //
    // Create SageMaker Studio Domain Execution Role
    //
    const sageMakerTagsDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'SageMakerTagsAccess',
          effect: Effect.ALLOW,
          actions: [
            'sagemaker:AddTags',
          ],
          resources: [`arn:aws:sagemaker:${region}:${account}:code-repository/*`], // "arn:aws:sagemaker:eu-west-1:768545273476:code-repository/*"
        }),
      ],
    });
    const sageMakerTagsPolicy = new Policy(this, 'SageMakerTagsPolicy', {
      policyName: `${this.prefix}-sagemaker-tags-policy`,
      document: sageMakerTagsDocument,
    });
    const codeConnectionUseDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'CodeConnectionUseAccess',
          effect: Effect.ALLOW,
          actions: [
            'codestar-connections:UseConnection',
          ],
          resources: [`arn:aws:codeconnections:${region}:${account}:connection/*`], // "arn:aws:codeconnections:eu-west-1:768545273476:connection/*"
        }),
      ],
    });
    const codeConnectionUsePolicy = new Policy(this, 'CodeConnectionUsePolicy', {
      policyName: `${this.prefix}-codeconnection-use-policy`,
      document: codeConnectionUseDocument,
    });
    const codeConnectionPassDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'CodeConnectionPassAccess',
          effect: Effect.ALLOW,
          actions: [
            'codestar-connections:PassConnection',
          ],
          resources: [`arn:aws:codeconnections:${region}:${account}:connection/*`], // "arn:aws:codeconnections:eu-west-1:768545273476:connection/*"
        }),
      ],
    });
    const codeConnectionPassPolicy = new Policy(this, 'CodeConnectionPassPolicy', {
      policyName: `${this.prefix}-codeconnection-pass-policy`,
      document: codeConnectionPassDocument,
    });
    const ssmParameterDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'SSMParameterAccess',
          effect: Effect.ALLOW,
          actions: [
            'ssm:GetParameter*',
            'ssm:DescribeParameters',
            'ssm:PutParameter*',
            'ssm:GetParametersByPath',
          ],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/rdi-mlops/*`],
        }),
      ],
    });
    const ssmParameterPolicy = new Policy(this, 'SSMParameterPolicy', {
      policyName: `${this.prefix}-ssm-parameter-policy`,
      document: ssmParameterDocument,
    });
    const codeCommitPolicyDocument = new PolicyDocument({
      statements: [
        // Grant Access to code commit
        new PolicyStatement({
          sid: 'AllowRepoAccess',
          effect: Effect.ALLOW,
          actions: [
            'codecommit:BatchGet*',
            'codecommit:Create*',
            'codecommit:DeleteBranch',
            'codecommit:Get*',
            'codecommit:List*',
            'codecommit:Describe*',
            'codecommit:Put*',
            'codecommit:Post*',
            'codecommit:Merge*',
            'codecommit:Test*',
            'codecommit:Update*',
            'codecommit:GitPull',
            'codecommit:GitPush'
          ],
          resources: [`arn:aws:codecommit:${region}:${account}:sagemaker-${this.prefix}*`],
        }),
      ],
    });
    const codeCommitPolicy = new Policy(this, 'CodeCommitPolicy', {
      policyName: `${this.prefix}-codecommit-policy`,
      document: codeCommitPolicyDocument,
    });

    this.executionRole = new Role(this, 'StudioRole', {
      roleName: `${this.prefix}-sagemaker-studio-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFeatureStoreAccess'),
      ],
    });
    // Attach the data access, SSM Parameter Store and Code Commit policies to the execution role
    this.executionRole.attachInlinePolicy(props.dataAccessPolicy);
    this.executionRole.attachInlinePolicy(ssmParameterPolicy);
    this.executionRole.attachInlinePolicy(codeCommitPolicy);

    //
    // Create SageMaker Service Catalo Roles
    //
    const serviceCatalogRoles = new RDISagemakerServiceCataloRoles(this, 'ServiceCatalogRoles', {
        prefix: this.prefix,
        removalPolicy: this.removalPolicy,
        runtime: this.runtime,
        customResourceLayerArn: props.customResourceLayerArn,
    });
    this.cloudFormationRoleName = serviceCatalogRoles.serviceCatalogProductsCloudFormationRoleName

    //
    // Create SageMaker Studio Domain
    //
    // Create the SageMaker Studio Domain using the custom resource
    const domain = new RDISagemakerDomainCustomResource(this, 'Domain', {
      prefix: this.prefix,
      sagemakerStudioDomainName: this.domainName,
      defaultUserSettingsExecutionRoleArn:  this.executionRole.roleArn,
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      customResourceLayerArn: props.customResourceLayerArn,
    });
    domain.node.addDependency(serviceCatalogRoles);
    this.domainId = domain.domainId;
    this.portfolioId = domain.portfolioId;

    // Create SageMaker User
    // Create the user profile
    const sagemakerUser = new CfnUserProfile(this, 'User', {
      domainId: this.domainId,
      userProfileName: this.userName,
    });
    sagemakerUser.node.addDependency(domain);
    // Add removal policy to the user profile
    sagemakerUser.applyRemovalPolicy(this.removalPolicy);

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
        customResourceLayerArn: props.customResourceLayerArn,
        sagemakerStudioDomainId: this.domainId,
        sagemakerStudioUserProfile: this.userName,
      });
      cleanupDomain.node.addDependency(sagemakerUser);
    }

    const iamPassRole = new PolicyStatement({
      sid: 'iamPassRole',
      actions: [
        'iam:PassRole',
      ],
      effect: Effect.ALLOW,
      resources: [
         `arn:aws:iam::${account}:role/service-role/${serviceCatalogRoles.serviceCatalagProductsExecutionRoleName}`,
        `${domain.eventBridgeSchedulerRole.roleArn}`,
      ],
    })
    props.monitoringJobPolicy.addStatements(iamPassRole);

    const serviceCatalogProductsCodePipelineRole = Role.fromRoleName(this, 'ServiceCatalogProductsCodePipelineRole',
        serviceCatalogRoles.serviceCatalogProductsCodePipelineRoleName
    );
    serviceCatalogProductsCodePipelineRole.attachInlinePolicy(codeConnectionUsePolicy);

    const serviceCatalagProductsLaunchRole = Role.fromRoleName(this, 'ServiceCatalagProductsLaunchRole',
        serviceCatalogRoles.serviceCatalagProductsLaunchRoleName
    );
    serviceCatalagProductsLaunchRole.attachInlinePolicy(codeConnectionPassPolicy);
    serviceCatalagProductsLaunchRole.attachInlinePolicy(sageMakerTagsPolicy);

    const serviceCatalogProductsCodeBuildRole = Role.fromRoleName(this, 'ServiceCatalogProductsCodeBuildRole',
        serviceCatalogRoles.serviceCatalogProductsCodeBuildRoleName
    );
    serviceCatalogProductsCodeBuildRole.attachInlinePolicy(ssmParameterPolicy);

    // Attach the data access policy to the IAM service role AmazonSageMakerServiceCatalogProductsUseRole
    // This is the role that will be automatically used by the SageMaker project for the MLOps pipeline
    // actions and it needs to have access to the data buckets and Feature Store
    const serviceCatalogProductsUseRole = Role.fromRoleName(this, 'ServiceCatalogProductsUseRole',
      serviceCatalogRoles.serviceCatalogProductsUseRoleName
    );
    serviceCatalogProductsUseRole.attachInlinePolicy(props.dataAccessPolicy);
    serviceCatalogProductsUseRole.attachInlinePolicy(ssmParameterPolicy);
    serviceCatalogProductsUseRole.attachInlinePolicy(props.monitoringJobPolicy);
    // Add additional policies to the role for IAM, Lambda Function and SageMaker Pipelines
    const additionalProjectRolePolicies = new Policy(this, 'AdditionalPolicies', {
      policyName: `${this.prefix}-additional-policies`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'iam:List*',
              'iam:Get*',
              'iam:DeleteRole',
              'iam:CreateRole',
              'iam:CreatePolicy',
              'iam:AttachRolePolicy',
              'iam:DetachRolePolicy',
              'iam:PutRolePolicy',
              'iam:DeleteRolePolicy',
              'iam:Tag*',
              'iam:Untag*',
              'iam:PassRole',
            ],
            resources: [
              `arn:aws:iam::${account}:role/${this.prefix}-*`,
              `arn:aws:iam::${account}:policy/${this.prefix}-*`,
            ],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'lambda:Get*',
              'lambda:CreateFunction',
              'lambda:PublishVersion',
              'lambda:UpdateFunction*',
              'lambda:DeleteFunction',
              'lambda:AddPermission',
              'lambda:RemovePermission',
              'lambda:AddLayerVersionPermission',
              'lambda:RemoveLayerVersionPermission',
              'lambda:TagResource',
              'lambda:UntagResource',
              'lambda:List*',
            ],
            resources: [
              `arn:aws:lambda:${region}:${account}:function:${this.prefix}-*`,
            ],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'sagemaker:CreatePipeline',
              'sagemaker:DeletePipeline',
              'sagemaker:DescribePipeline',
              'sagemaker:ListPipelines',
              'sagemaker:UpdatePipeline',
            ],
            resources: [
              `arn:aws:sagemaker:${region}:${account}:pipeline/${this.prefix}-*`,
            ],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'cloudwatch:PutMetricAlarm',
              'cloudwatch:DeleteAlarms',
              'cloudwatch:Describe*',
              'cloudwatch:*AlarmActions',
              'cloudwatch:PutDashboard',
              'cloudwatch:DeleteDashboards',
            ],
            resources: [
              `arn:aws:cloudwatch:${region}:${account}:alarm:${this.prefix}-*`,
              `arn:aws:cloudwatch::${account}:dashboard/${this.prefix}-*`,
            ],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'cloudwatch:Get*',
              'cloudwatch:List*',
              'cloudwatch:PutMetricData',
            ],
            resources: ['*'],
          }),
        ],
      }),
    });
    serviceCatalogProductsUseRole.attachInlinePolicy(additionalProjectRolePolicies);
  }
}
