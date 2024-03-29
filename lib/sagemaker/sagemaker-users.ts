import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
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
import { CfnUserProfile, CfnApp } from 'aws-cdk-lib/aws-sagemaker';


interface RDISagemakerUserProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly domainName: string;
  readonly domainId: string;
  readonly name:string;
}

export class RDISagemakerUser extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly role: IRole;
  public readonly domainName: string;
  public readonly domainId: string;
  public readonly name: string;
  public readonly appName: string;
  public readonly userProfile: CfnUserProfile;

  constructor(scope: Construct, id: string, props: RDISagemakerUserProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.domainName = props.domainName;
    this.domainId = props.domainId;
    this.name = props.name;
    this.appName = `${this.prefix}-sagemaker-user-app`
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // 
    // Create a SageMaker Studio user Role
    //
    const userRole = new Role(this, 'Role', {
      roleName: `${this.prefix}-sagemaker-user-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess')
      ],
    });
    // Add access to raw data bucket
    userRole.attachInlinePolicy(new Policy(this, 'S3Policy', {
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
    // Add access to data catalog partitions
    // Note: This was not necessary before and should be included in the AmazonSageMakerFullAccess policy
    // That policy gives GetDatabases, GetTables, GetTable on everything but not GetPartitions
    userRole.attachInlinePolicy(new Policy(this, 'GluePolicy', {
      policyName: `${this.prefix}-missing-glue-partitions`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'glue:GetPartitions', 
            ],
            resources: [
              'arn:aws:glue:*:*:catalog',
              'arn:aws:glue:*:*:database/sagemaker_featurestore',
              'arn:aws:glue:*:*:table/sagemaker_featurestore/*'
            ],
          }),
        ],
      })
    }));

    // Create the user profile
    this.userProfile = new CfnUserProfile(this, 'Profile', {
      domainId: this.domainId,
      userProfileName: this.name,
      userSettings: {
        executionRole: userRole.roleArn,
      },
    });
    // Add removal policy to the user profile
    this.userProfile.applyRemovalPolicy(this.removalPolicy);

    // Create an app for the SageMaker studio user
    const studioApp = new CfnApp(this, 'App', {
      appName: this.appName,
      appType: 'JupyterServer',
      domainId: this.domainId,
      userProfileName: this.userProfile.userProfileName,
    });
    // Force dependency on the user profile
    studioApp.node.addDependency(this.userProfile);
    // add removal policy to the app
    studioApp.applyRemovalPolicy(this.removalPolicy);
  } 
}