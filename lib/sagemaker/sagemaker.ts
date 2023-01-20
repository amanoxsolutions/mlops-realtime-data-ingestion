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
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnDomain, CfnUserProfile, CfnApp } from 'aws-cdk-lib/aws-sagemaker';
import { SageMakerClient, ListDomainsCommand } from "@aws-sdk/client-sagemaker";


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
  readonly vpcId: string;
}

export class CleanupSagemakerDomain extends Construct {

  constructor(scope: Construct, id: string, props: CleanupSagemakerDomainProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;
    const lambdaPurpose = 'CustomResourceToCleanupSageMakerDomain'

    // SageMaker, EC2, EFS access policy
    const accessPolicy = new PolicyStatement({
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
        VPC_ID: props.vpcId,
      },
      timeout: Duration.minutes(10),
      runtime: Runtime.PYTHON_3_9,
      logRetention: RetentionDays.ONE_WEEK,
    });
    customResourceLambda.addToRolePolicy(accessPolicy);

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
    // Check if there are any existing domains
    // N.B.: As of now you can only have one domain per account and region
    const client = new SageMakerClient({ region: process.env.region });
    const command = new ListDomainsCommand({});
    let domainName = '';
    let domainId = '';
    client.send(command).then(
      (data:any) => {
        // Get the first domain name and id
        if (data.Domains.length > 0) {
          domainName = data.Domains[0].DomainDetails.DomainName;
          domainId = data.Domains[0].DomainDetails.DomainId;
        }
      },
      (error) => {
        console.log(`Error: ${error}`);
      }
    );
    // Should we need to create a new domain, we need a name for it
    const thisDomainName = `${this.prefix}-sagemaker-studio-domain`;

    // Create/Update/Delete SageMaker Studio Resources only if there is no domain already
    if (domainName === '') {
      // Create the IAM Role for SagMaker Studio
      this.role = new Role(this, 'StudioRole', {
        roleName: `${this.prefix}-sagemaker-studio-role`,
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      });
      this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'));
      this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess'));
      this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFeatureStoreAccess'));

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
      new Policy(this, 'lambdaPolicy', {
        policyName: `${this.prefix}-sagemaker-studio-s3-access-policy`,
        document: policyDocument,
        roles: [this.role],
      });

      // Create the SageMaker Studio Domain
      const domain = new CfnDomain(this, 'StudioDomain', {
        domainName: thisDomainName,
        vpcId: props.vpcId,
        subnetIds: props.subnetIds,
        authMode: 'IAM',
        defaultUserSettings: {
          executionRole: this.role.roleArn,
        },
      });
      this.domainName = domain.domainName;
      this.domainId = domain.attrDomainId;

      // Create the user profile
      const studioUser = new CfnUserProfile(this, 'StudioUser', {
        domainId: domain.attrDomainId,
        userProfileName: this.userName,
        userSettings: {
          executionRole: userRole.roleArn,
        },
      });
      // Add removal policy to the user profile
      studioUser.applyRemovalPolicy(this.removalPolicy);

      // Create an app for the SageMaker studio user
      const studioApp = new CfnApp(this, 'StudioApp', {
        appName: `${this.prefix}-sagemaker-studio-app`,
        appType: 'JupyterServer',
        domainId: domain.attrDomainId,
        userProfileName: studioUser.userProfileName,
      });
      // Force dependency on the user profile
      studioApp.node.addDependency(studioUser);
      // add removal policy to the app
      studioApp.applyRemovalPolicy(this.removalPolicy);

      // Custom Resource to clean upp the SageMaker Studio Domain and User by
      // deleting the apps which might have been created by the user
      // The SageMaker user can't be deleted if there are apps associated with it
      if (this.removalPolicy === RemovalPolicy.DESTROY) {
        new CleanupSagemakerStudio(this, 'CleanupSagemakerStudio', {
          prefix: this.prefix,
          sagemakerStudioDomainId: domain.attrDomainId,
          sagemakerStudioUserProfile: studioUser.userProfileName,
          sagemakerStudioAppName: studioApp.appName,
        });

        // If we created a new domain we will need to clean it up
        const cleanupSagemakerDomain = new CleanupSagemakerDomain(this, 'CleanupSagemakerDomain', {
          prefix: this.prefix,
          sagemakerStudioDomainId: domain.attrDomainId,
          vpcId: props.vpcId,
        });
        cleanupSagemakerDomain.node.addDependency(domain);
      }
    } else {
      this.domainName = domainName;
      this.domainId = domainId;

      // Create the user profile
      const studioUser = new CfnUserProfile(this, 'StudioUser', {
        domainId: this.domainId,
        userProfileName: this.userName,
        userSettings: {
          executionRole: userRole.roleArn,
        },
      });
      // Add removal policy to the user profile
      studioUser.applyRemovalPolicy(this.removalPolicy);

      // Create an app for the SageMaker studio user
      const studioApp = new CfnApp(this, 'StudioApp', {
        appName: `${this.prefix}-sagemaker-studio-app`,
        appType: 'JupyterServer',
        domainId: this.domainId,
        userProfileName: studioUser.userProfileName,
      });
      // Force dependency on the user profile
      studioApp.node.addDependency(studioUser);
      // add removal policy to the app
      studioApp.applyRemovalPolicy(this.removalPolicy);

      // Custom Resource to clean upp the SageMaker Studio Domain and User by
      // deleting the apps which might have been created by the user
      // The SageMaker user can't be deleted if there are apps associated with it
      if (this.removalPolicy === RemovalPolicy.DESTROY) {
        new CleanupSagemakerStudio(this, 'CleanupSagemakerStudio', {
          prefix: this.prefix,
          sagemakerStudioDomainId: this.domainId,
          sagemakerStudioUserProfile: studioUser.userProfileName,
          sagemakerStudioAppName: studioApp.appName,
        });
      }
    }
  } 
}