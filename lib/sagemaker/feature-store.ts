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
import { CfnFeatureGroup } from 'aws-cdk-lib/aws-sagemaker';
import * as fgConfig from '../../resources/sagemaker/agg-fg-schema.json';

enum FeatureStoreTypes {
  DOUBLE  = 'Fractional',
  BIGINT = 'Integral',
  STRING = 'String',
}

interface RDIFeatureStoreProps {
  readonly prefix: string;
}

export class RDIFeatureStore extends Construct {
  public readonly prefix: string;
  public readonly aggFeatureGroup: CfnFeatureGroup;

  constructor(scope: Construct, id: string, props: RDIFeatureStoreProps) {
    super(scope, id);

    this.prefix = props.prefix;

    // Create the IAM Role for Feature Store
    const fgRole = new Role(this, 'featureStoreRole', {
      roleName: `${this.prefix}-feature-store-role`,
      assumedBy: new ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess')],
    });

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
      offlineStoreConfig: {'EnableOfflineStore': true},
      onlineStoreConfig: {'EnableOnlineStore': true},
      roleArn: fgRole.roleArn,
    });
  
  }
}