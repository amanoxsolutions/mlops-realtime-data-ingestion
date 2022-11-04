import { Construct } from 'constructs';
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
import { CfnDomain } from 'aws-cdk-lib/aws-sagemaker';

interface RDISagemakerStudioProps {
  readonly prefix: string;
  readonly dataBucketArn: string;
  readonly vpcId: string;
  readonly subnetIds: string[];
}

export class RDISagemakerStudio extends Construct {
  public readonly prefix: string;
  public readonly role: IRole;
  public readonly domain: CfnDomain;

  constructor(scope: Construct, id: string, props: RDISagemakerStudioProps) {
    super(scope, id);

    this.prefix = props.prefix;

    // Create the IAM Role for SagMaker Studio
    this.role = new Role(this, 'studioRole', {
        roleName: `${this.prefix}-sagemaker-studio-role`,
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      });
      this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonSageMakerFullAccess'));
      this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonSageMakerCanvasFullAccess'));

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
    this.domain = new CfnDomain(this, 'studioDomain', {
      domainName: `${this.prefix}-sagemaker-studio-domain`,
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      authMode: 'IAM',
      defaultUserSettings: {
        executionRole: this.role.roleArn,
      },
    });
  }
}