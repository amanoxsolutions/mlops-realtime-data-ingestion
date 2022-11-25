import { Construct } from 'constructs';
import { Duration, CustomResource } from 'aws-cdk-lib';
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
  public readonly sagemakerDomainName: string;

  constructor(scope: Construct, id: string, props: RDISagemakerStudioProps) {
    super(scope, id);

    this.prefix = props.prefix;

    // Custom Resource to check if there are any existing domains
    // N.B.: As of now you can only have one domain per account and region
    const sagemakerListPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['sagemaker:listDomains'],
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
    const sagemakerDomains = customResource.getAtt('SageMakerDomains').toString();
    // convert the comma separated string into a list
    const sagemakerDomainsList = sagemakerDomains.split(',');
    // Should we need to create a new domain, we need a name for it
    const thisDomainName = `${this.prefix}-sagemaker-studio-domain`;

    // Create/Update/Delete SageMaker Studio Resources only if there is no domain already
    // or the domain is the one in the list
    if (sagemakerDomainsList.length === 0 || sagemakerDomainsList.includes(thisDomainName)) {
      // Create the IAM Role for SagMaker Studio
      this.role = new Role(this, 'studioRole', {
          roleName: `${this.prefix}-sagemaker-studio-role`,
          assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        });
        this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'));
        this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerCanvasFullAccess'));

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
      const domain = new CfnDomain(this, 'studioDomain', {
        domainName: thisDomainName,
        vpcId: props.vpcId,
        subnetIds: props.subnetIds,
        authMode: 'IAM',
        defaultUserSettings: {
          executionRole: this.role.roleArn,
        },
      });
      this.sagemakerDomainName = domain.domainName;
    } else {
      // If there is an existing domain, we need to get the name from the list
      // Ath the moment there is only one domain per account and region
      this.sagemakerDomainName = sagemakerDomainsList[0];
    }
  } 
}