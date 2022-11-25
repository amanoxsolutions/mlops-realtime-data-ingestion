import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { ManagedPolicy, Role, ServicePrincipal, Policy, PolicyStatement, PolicyDocument, Effect } from 'aws-cdk-lib/aws-iam';
import { Bucket, BucketAccessControl, BucketEncryption, IBucket } from 'aws-cdk-lib/aws-s3';
import { CfnFeatureGroup } from 'aws-cdk-lib/aws-sagemaker';
import * as fgConfig from '../../resources/sagemaker/agg-fg-schema.json';

enum FeatureStoreTypes {
  DOUBLE  = 'Fractional',
  BIGINT = 'Integral',
  STRING = 'String',
}

interface RDIFeatureStoreProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
}

export class RDIFeatureStore extends Construct {
  public readonly prefix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly aggFeatureGroup: CfnFeatureGroup;
  public readonly bucket: IBucket;

  constructor(scope: Construct, id: string, props: RDIFeatureStoreProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;

    // Create an S3 Bucket for the Offline Feature Store
    this.bucket = new Bucket(this, 'featureStoreBucket', {
      bucketName: `${this.prefix}-sagemaker-feature-store-bucket`,
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy == RemovalPolicy.DESTROY
    });


    // Create the IAM Role for Feature Store
    const fgRole = new Role(this, 'featureStoreRole', {
      roleName: `${this.prefix}-sagemaker-feature-store-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')],
    });
    fgRole.attachInlinePolicy(new Policy(this, 'EcsTaskPolicy', {
      policyName: `${this.prefix}-sagemaker-feature-store-s3-bucket-access`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              's3:GetObject', 
              's3:PutObject', 
              's3:DeleteObject', 
              's3:AbortMultipartUpload', 
              's3:GetBucketAcl', 
              's3:PutObjectAcl'
            ],
            resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
          }),
        ],
      })
    }));

    // Create the Feature Group
    const cfnFeatureGroup = new CfnFeatureGroup(this, 'MyCfnFeatureGroup', {
      eventTimeFeatureName: fgConfig.event_time_feature_name,
      featureDefinitions: fgConfig.features.map(
        (feature: { name: string; type: string }) => ({
          featureName: feature.name,
          featureType: FeatureStoreTypes[feature.type as keyof typeof FeatureStoreTypes],
        })
      ),
      featureGroupName: `${this.prefix}-agg-feature-group`,
      recordIdentifierFeatureName: fgConfig.record_identifier_feature_name,
    
      // the properties below are optional
      description: fgConfig.description,
      offlineStoreConfig: {
        S3StorageConfig: {
          S3Uri: this.bucket.s3UrlForObject()
        }
      },
      onlineStoreConfig: {'EnableOnlineStore': true},
      roleArn: fgRole.roleArn,
    });
  
  }
}