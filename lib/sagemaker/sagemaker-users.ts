import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Role } from 'aws-cdk-lib/aws-iam';
import { CfnUserProfile, CfnApp } from 'aws-cdk-lib/aws-sagemaker';


interface RDISagemakerUserProps {
  readonly prefix: string;
  readonly removalPolicy?: RemovalPolicy;
  readonly dataBucketArn: string;
  readonly domainName: string;
  readonly domainId: string;
  readonly name:string;
  readonly role: Role;
}

export class RDISagemakerUser extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly role: Role;
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
    this.role = props.role;

    // Create the user profile
    this.userProfile = new CfnUserProfile(this, 'Profile', {
      domainId: this.domainId,
      userProfileName: this.name,
      userSettings: {
        executionRole: this.role.roleArn,
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