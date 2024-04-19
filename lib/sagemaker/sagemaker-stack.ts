import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement, Effect, Policy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { RDISagemakerStudio } from './sagemaker-domain';
import { RDIFeatureStore } from './feature-store';
import { RDISagemakerProject } from './sagemaker-project';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Dashboard, GraphWidget } from 'aws-cdk-lib/aws-cloudwatch';
import { RDIIngestionPipelineDashboard } from './dashboard';
import { RDICleanupStepFunction } from './cleanup-project';


export interface SagemakerStackProps extends StackProps {
  readonly prefix: string;
  readonly s3Suffix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly runtime: Runtime;
  readonly vpc: IVpc;
  readonly ingestionPipelineDashboard: Dashboard;
  readonly ingestionPipelineWidget: GraphWidget;
}
  
export class SagemakerStack extends Stack {
  public readonly prefix: string;
  public readonly s3Suffix: string;
  public readonly removalPolicy: RemovalPolicy;
  public readonly runtime: Runtime;
  public readonly domain: RDISagemakerStudio;
  public readonly featureStore: RDIFeatureStore;
  public readonly project: RDISagemakerProject;
  public readonly experimentBucket: IBucket;
  public readonly ingestionPipelineDashboard: Dashboard;

  constructor(scope: Construct, id: string, props: SagemakerStackProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.s3Suffix = props.s3Suffix;
    this.runtime = props.runtime;
    this.removalPolicy = props.removalPolicy || RemovalPolicy.DESTROY;
    this.ingestionPipelineDashboard = props.ingestionPipelineDashboard;

    // Get the necessary information of the ingestion stack from SSM parameters
    const customResourceLayerArn = StringParameter.fromStringParameterAttributes(this, 'CustomResourceLayerArn', {
      parameterName: '/rdi-mlops/stack-parameters/custom-resource-layer-arn',
    }).stringValue

    const ingestionDataStreamArn = StringParameter.fromStringParameterAttributes(this, 'IngestionStreamArnSSMParameter', {
      parameterName: 'rdi-mlops/stack-parameters/ingestion-data-stream-arn',
    }).stringValue

    const ingestionDataStreamName = StringParameter.fromStringParameterAttributes(this, 'IngestionStreamNameSSMParameter', {
      parameterName: 'rdi-mlops/stack-parameters/ingestion-data-stream-name',
    }).stringValue

    const dataBucketArn = StringParameter.fromStringParameterAttributes(this, 'DataBucketSSMParameter', {
      parameterName: '/rdi-mlops/stack-parameters/ingestion-data-bucket-arn',
    }).stringValue

    // S3 bucket to store the Model artifacts
    this.experimentBucket = new Bucket(this, 'ExperimentBucket', {
      bucketName: `${this.prefix}-sagemaker-experiment-${this.s3Suffix}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY,
    });

    // Create IAM policy to access the buckets
    const dataAccessDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          sid: 'InputAndExperimentBucketsAccess',
          actions: [
            's3:ListBucket',
            's3:ListAllMyBuckets',
            's3:GetBucket*',
            's3:GetObject*', 
            's3:PutObject*', 
            's3:DeleteObject*', 
          ],
          effect: Effect.ALLOW,
          resources: [
            dataBucketArn,
            `${dataBucketArn}/*`,
            this.experimentBucket.bucketArn,
            `${this.experimentBucket.bucketArn}/*`,
          ],
        }),
        new PolicyStatement({
          sid: 'GlueAccess',
          effect: Effect.ALLOW,
          actions: [
            'glue:GetDatabase*',
            'glue:GetTable*',
            'glue:GetPartition*', 
            'glue:SearchTables',
          ],
          resources: [
            'arn:aws:glue:*:*:catalog',
            'arn:aws:glue:*:*:database/sagemaker_featurestore',
            'arn:aws:glue:*:*:table/sagemaker_featurestore/*',
            `arn:aws:glue:*:*:table/${this.prefix}*`,
            `arn:aws:glue:*:*:tableVersion/${this.prefix}*`,
          ],
        }),
        new PolicyStatement({
          sid: 'AthenaAccess',
          effect: Effect.ALLOW,
          actions: [
            'athena:ListDataCatalogs',
            'athena:ListDatabases',
            'athena:ListTableMetadata',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
            'athena:StartQueryExecution',
            'athena:StopQueryExecution',
          ],
          resources: ['*'],
        }),
      ],
    });
    const dataAccessPolicy = new Policy(this, 'DataPolicy', {
      policyName: `${this.prefix}-data-access-policy`,
      document: dataAccessDocument,
    });
    const monitoringJobDocument = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'scheduler:Get*',
            'scheduler:List*',
          ],
          resources: [
            `arn:aws:scheduler:${this.region}:${this.account}:schedule/default/*`,
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'scheduler:CreateSchedule',
            'scheduler:UpdateSchedule',
            'scheduler:DeleteSchedule',
            'scheduler:TagResource',
            'scheduler:UntagResource',
          ],
          resources: [
            `arn:aws:scheduler:${this.region}:${this.account}:schedule/default/${this.prefix}-*`,
          ],
        }),
      ],
    });
    const monitoringJobPolicy = new Policy(this, 'MonitoringJobPolicy', {
      policyName: `${this.prefix}-sagemaker-monitoringjob-policy`,
      document: monitoringJobDocument,
    });

    // this.domain = new RDISagemakerStudio(this, 'sagemakerStudio', {
    //   prefix: this.prefix,
    //   removalPolicy: this.removalPolicy,
    //   runtime: this.runtime,
    //   dataBucketArn: dataBucketArn,
    //   experimentBucketArn: this.experimentBucket.bucketArn,
    //   dataAccessPolicy: dataAccessPolicy,
    //   monitoringJobPolicy: monitoringJobPolicy,
    //   vpcId: props.vpc.vpcId,
    //   subnetIds: props.vpc.selectSubnets({ subnetType: SubnetType.PUBLIC }).subnetIds,
    //   customResourceLayerArn: customResourceLayerArn,
    // });

    this.featureStore = new RDIFeatureStore(this, 'featureStore', {
      prefix: this.prefix,
      removalPolicy: this.removalPolicy,
      runtime: this.runtime,
      customResourceLayerArn: customResourceLayerArn,
      ingestionDataStreamArn: ingestionDataStreamArn,
      ingestionDataStreamName: ingestionDataStreamName,
      s3Suffix: this.s3Suffix,
      dataAccessPolicy: dataAccessPolicy,
    });

    // this.project = new RDISagemakerProject(this, 'sagemakerProject', {
    //   prefix: this.prefix,
    //   removalPolicy: this.removalPolicy,
    //   runtime: this.runtime,
    //   customResourceLayerArn: customResourceLayerArn,
    //   portfolioId: this.domain.portfolioId,
    //   domainExecutionRole: this.domain.executionRole,
    //   dataAccessPolicy: dataAccessPolicy,
    // });

    // Add the Kinesis Analytics input metric to the ingestion pipeline dashboard
    // new RDIIngestionPipelineDashboard(this, 'IngestionPipelineDashboard', {
    //   prefix: this.prefix,
    //   dashboard: this.ingestionPipelineDashboard,
    //   flinkAppName: this.featureStore.flinkAppName,
    // });

    // Store SageMaker environment values in SSM Parameter Store.
    // We need to store 
    // - the SageMaker Project Name, 
    // - the SageMaker project ID,
    // - the SageMaker project bucket Name and ARN
    // - the SageMaker Feature Group Name
    // - the SageMaker feature Store bucket name and ARN
    // - the SageMaker execution role ARN
    // new StringParameter(this, 'SagemakerProjectNameSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-project-name',
    //   stringValue: this.project.projectName,
    //   description: 'SageMaker Project Name',
    // });
    // new StringParameter(this, 'SagemakerProjectIdSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-project-id',
    //   stringValue: this.project.projectId,
    //   description: 'SageMaker Project ID',
    // });
    // new StringParameter(this, 'SagemakerProjectBucketNameSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-project-bucket-name',
    //   stringValue: `sagemaker-project-${this.project.projectId}`,	
    //   description: 'SageMaker Project Bucket Name',
    // });
    // new StringParameter(this, 'SagemakerProjectBucketArnSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-project-bucket-arn',
    //   stringValue: `arn:aws:s3:::sagemaker-project-${this.project.projectId}`,	
    //   description: 'SageMaker Project Bucket ARN',
    // });
    // new StringParameter(this, 'SagemakerFeatureGroupNameSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-feature-group-name',
    //   stringValue: this.featureStore.featureGroupName,	
    //   description: 'SageMaker Feature Group Name',
    // });
    // new StringParameter(this, 'SagemakerFeatureStoreBucketNameSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-feature-store-bucket-name',
    //   stringValue: this.featureStore.bucket.bucketName,	
    //   description: 'SageMaker Feature Store Bucket Name',
    // });
    // new StringParameter(this, 'SagemakerFeatureStoreBucketArnSSMParameter', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-feature-store-bucket-arn',
    //   stringValue: this.featureStore.bucket.bucketArn,	
    //   description: 'SageMaker Feature Store Bucket ARN',
    // });
    // new StringParameter(this, 'SagemakerExecutionRoleARN', {
    //   parameterName: '/rdi-mlops/stack-parameters/sagemaker-execution-role-arn',
    //   stringValue: this.domain.executionRole.roleArn,
    //   description: 'SageMaker Execution Role ARN',
    // });

    // Create a Step Function to cleanup the SageMaker resources
    // new RDICleanupStepFunction(this, 'CleanupSagemakerProject', {
    //   prefix: this.prefix,
    //   removalPolicy: this.removalPolicy,
    //   runtime: this.runtime,
    //   sagemakerProjectBucketArn: `arn:aws:s3:::sagemaker-project-${this.project.projectId}`,
    // });
  }
}