import { Construct } from 'constructs';
import { Stack, Duration, CustomResource, RemovalPolicy, CfnCondition, Fn } from 'aws-cdk-lib';
import {
  IRole,
  ManagedPolicy,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Effect,
  CfnRole,
  CfnPolicy
} from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnDomain, CfnUserProfile, CfnApp } from 'aws-cdk-lib/aws-sagemaker';


interface CleanupSagemakerStudioProps {
  readonly prefix: string;
  readonly sagemakerStudioDomainId: string;
  readonly sagemakerStudioUserProfile: string;
  readonly sagemakerStudioAppName: string;
}

export class CleanupSagemakerStudio extends Construct {

  constructor(scope: Construct, id: string, props: CleanupSagemakerStudioProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerStudio'

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
        'sagemaker:DeleteApp'
      ],
      resources: [`arn:aws:sagemaker:${region}:${account}:app/${props.sagemakerStudioDomainId}/${props.sagemakerStudioUserProfile}/*/*`],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${props.prefix}-cleanup-sagemaker-studio`,
      lambdaPurpose: lambdaPurpose,
      uuid: '33b41147-8a9b-4300-856f-d5b5a3daab3e',
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_studio'),
      handler: 'main.lambda_handler',
      environment: {
        PHYSICAL_ID: lambdaPurpose,
        SAGEMAKER_DOMAIN_ID: props.sagemakerStudioDomainId,
        SAGEMAKER_USER_PROFILE: props.sagemakerStudioUserProfile,
        SAGEMAKER_APP_NAME: props.sagemakerStudioAppName,
      },
      timeout: Duration.minutes(10),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(sagemakerList);
    customResourceLambda.addToRolePolicy(sagemakerDeleteApp);

    new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
    });
  }
}

interface CleanupSagemakerDomainProps {
  readonly prefix: string;
  readonly sagemakerStudioDomainId: string;
}

export class CleanupSagemakerDomain extends Construct {

  constructor(scope: Construct, id: string, props: CleanupSagemakerDomainProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerDomain'

    const sagemakerPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'sagemaker:*',
        'efs:*',
        'ec2:*',
      ],
      resources: ['*'],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${props.prefix}-cleanup-sagemaker-domain`,
      lambdaPurpose: lambdaPurpose,
      uuid: 'bdaf37bd-4318-8cde--7af6b0b23758dd1f',
      code: Code.fromAsset('resources/lambdas/cleanup_sagemaker_domain'),
      handler: 'main.lambda_handler',
      environment: {
        PHYSICAL_ID: lambdaPurpose,
        SAGEMAKER_DOMAIN_ID: props.sagemakerStudioDomainId,
      },
      timeout: Duration.minutes(10),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(sagemakerPolicy);

    new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
    });
  }
}

interface RDISagemakerStudioProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
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
    this.userName = `${this.prefix}-sagemaker-user`;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // 
    // Create a SageMaker Studio user Role
    //
    const userRole = new Role(this, 'UserRole', {
      roleName: `${this.prefix}-sagemaker-user-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess')
      ],
    });
    // Add access to raw data bucket
    userRole.attachInlinePolicy(new Policy(this, 'UserPolicy', {
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

    //
    // Create SageMaker Studio Domain
    //
    // Custom Resource to check if there are any existing domains
    // N.B.: As of now you can only have one domain per account and region
    const sagemakerListPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sagemaker:ListDomains'],
      resources: ['*'],
    });

    const customResourceLambda = new SingletonFunction(this, 'Singleton', {
      functionName: `${props.prefix}-check-sagemaker-domain`,
      lambdaPurpose: 'CustomResourceToCheckForExistingSageMakerStudioDomain',
      uuid: '06f1074e-1221-4317-83cc-498f60746e09',
      code: Code.fromAsset('resources/lambdas/check_sagemaker_domain'),
      handler: 'main.lambda_handler',
      timeout: Duration.seconds(3),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(sagemakerListPolicy);

    const customResource = new CustomResource(this, 'Resource', {
      serviceToken: customResourceLambda.functionArn,
    });
    // Get the list of {domainName, domainId} from the custom resource output SageMakerDomains attribute
    const domainName = customResource.getAtt('SagemakerDomainName').toString();
    const domainId = customResource.getAtt('SagemakerDomainId').toString();
    // Should we need to create a new domain, we need a name for it
    const thisDomainName = `${this.prefix}-sagemaker-studio-domain`;

    // Create/Update/Delete SageMaker Studio Resources only if there is no domain already
    const shouldCreateSageMakerStudioCondition = new CfnCondition(this, 'ShouldCreateSageMakerStudio', {
      expression: Fn.conditionEquals(domainName, ''),
    });

    // Create the IAM Role for SagMaker Studio only if there is no domain already
    this.role = new Role(this, 'StudioRole', {
      roleName: `${this.prefix}-sagemaker-studio-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });
    this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'));
    this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess'));
    this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFeatureStoreAccess'));
    (this.role.node.defaultChild as CfnRole).cfnOptions.condition = shouldCreateSageMakerStudioCondition;

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
    const studioRolePoliy = new Policy(this, 'lambdaPolicy', {
      policyName: `${this.prefix}-sagemaker-studio-s3-access-policy`,
      document: policyDocument,
      roles: [this.role],
    });
    (studioRolePoliy.node.defaultChild as CfnPolicy).cfnOptions.condition = shouldCreateSageMakerStudioCondition;

    // Create the SageMaker Studio Domain only if there is no domain already
    const domain = new CfnDomain(this, 'StudioDomain', {
      domainName: thisDomainName,
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      authMode: 'IAM',
      defaultUserSettings: {
        executionRole: this.role.roleArn,
      },
    });
    domain.cfnOptions.condition = shouldCreateSageMakerStudioCondition;

    let dependencyOnSageMakerStudioDomain = false;
    if (domainName === '') {
      this.domainName = domain.domainName;
      this.domainId = domain.attrDomainId;
      dependencyOnSageMakerStudioDomain = true;
    } else {
      this.domainName = domainName;
      this.domainId = domainId;
    }
    
    // Create the user profile
    const studioUser = new CfnUserProfile(this, 'StudioUser', {
      domainId: this.domainId,
      userProfileName: this.userName,
      userSettings: {
        executionRole: userRole.roleArn,
      },
    });
    // It depends on the custom resource and the domain if it was created
    studioUser.node.addDependency(customResource);
    if (dependencyOnSageMakerStudioDomain) {
      studioUser.node.addDependency(domain);
    }
    // Add removal policy to the user profile
    studioUser.applyRemovalPolicy(this.removalPolicy);

    // Create an app for the SageMaker studio user
    const studioApp = new CfnApp(this, 'StudioApp', {
      appName: `${this.prefix}-sagemaker-studio-app`,
      appType: 'JupyterServer',
      domainId: this.domainId,
      userProfileName: studioUser.userProfileName,
    });
    // add dependency on the domain if it was created
    if (dependencyOnSageMakerStudioDomain) {
      studioApp.node.addDependency(domain);
    }
    // add removal policy to the app
    studioApp.applyRemovalPolicy(this.removalPolicy);

    // Custom Resource to clean upp the SageMaker Studio Domain and User by
    // deleting the apps which might have been created by the user
    // The SageMaker user can't be deleted if there are apps associated with it
    if (this.removalPolicy === RemovalPolicy.DESTROY) {
      new CleanupSagemakerStudio(this, 'CleanupSagemakerStudio', {
        prefix: this.prefix,
        sagemakerStudioDomainId: this.domainId,
        sagemakerStudioUserProfile: this.userName,
        sagemakerStudioAppName: studioApp.appName,
      });
      // add dependency on the user profile
      studioApp.node.addDependency(studioUser);

      // If we created a new domain we will need to clean it up
      if (dependencyOnSageMakerStudioDomain) {
        const cleanupSagemakerDomain = new CleanupSagemakerDomain(this, 'CleanupSagemakerDomain', {
          prefix: this.prefix,
          sagemakerStudioDomainId: this.domainId,
        });
        cleanupSagemakerDomain.node.addDependency(domain);
      }
    }
  } 
}