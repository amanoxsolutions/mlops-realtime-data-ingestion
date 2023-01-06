import { Construct } from 'constructs';
import { Duration, CustomResource, RemovalPolicy } from 'aws-cdk-lib';
import {
  IRole,
  ManagedPolicy,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Effect
} from 'aws-cdk-lib/aws-iam';
import { Runtime, Code, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnDomain, CfnUserProfile, CfnApp } from 'aws-cdk-lib/aws-sagemaker';


interface RDISagemakerStudioProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
}

export class RDISagemakerStudio extends Construct {
  public readonly prefix: string;
  public readonly role: IRole;
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly userName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerStudioProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.userName = `${this.prefix}-sagemaker-user`;

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
    if (this.domainName === '') {
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
    } else {
      this.domainName = domainName;
      this.domainId = domainId;
    }

    // 
    // Create a SageMaker Studio user
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
    
    // Create the user profile
    const studioUser = new CfnUserProfile(this, 'StudioUser', {
      domainId: this.domainId,
      userProfileName: this.userName,
      userSettings: {
        executionRole: userRole.roleArn,
      },
    });
    // It depends on the custom resource
    studioUser.node.addDependency(customResource);

    // Create an app for the SageMaker studio user
    const studioApp = new CfnApp(this, 'StudioApp', {
      appName: `${this.prefix}-sagemaker-studio-app`,
      appType: 'JupyterServer',
      domainId: this.domainId,
      userProfileName: this.userName,
      resourceSpec: {
        instanceType: 'ml.t3.medium',
      },
    });
  } 
}