import { Construct } from 'constructs';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Role, PolicyStatement, Effect, ServicePrincipal, Policy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { LogGroup, ILogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Vpc, IVpc, SubnetType, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { 
  Cluster, 
  ICluster, 
  ContainerImage, 
  FargateTaskDefinition, 
  IFargateTaskDefinition,
  CpuArchitecture,
  OperatingSystemFamily,
  LogDrivers,
  FargateService,
  IFargateService,
 } from 'aws-cdk-lib/aws-ecs';
import { IRepository } from 'aws-cdk-lib/aws-ecr';

interface RDIIngestionWorkerProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly ecrRepo: IRepository;
  readonly workerCpu?: number;
  readonly workerMemoryMiB?: number;
  readonly vpcCider?: string;
  readonly eventBusArn: string;
  readonly eventBusName: string;
  readonly eventDetailType: string;
  readonly kinesisFirehoseArn: string;
  readonly ingestionIntervalMSec?: number;
}

export class RDIIngestionWorker extends Construct {
  public readonly prefix: string;
  public readonly vpc: IVpc;
  public readonly ecsCluster: ICluster;
  public readonly fargateTask: IFargateTaskDefinition;
  public readonly fargateService: IFargateService;
  public readonly fargateLogGroup: ILogGroup;
  public readonly ingestionIntervalMSec: number;

  constructor(scope: Construct, id: string, props: RDIIngestionWorkerProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.ingestionIntervalMSec = props.ingestionIntervalMSec || 1000;

    //
    // VPC
    //
    // Setup the VPC and subnets
    const vpcCider = props.vpcCider || '10.0.0.0/16'
    this.vpc = new Vpc(this, 'Vpc', {
      vpcName: `${this.prefix}-ingestion-worker-vpc`,
      maxAzs: 1,
      cidr: vpcCider,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `${this.prefix}-nat-subnet`,
          subnetType: SubnetType.PUBLIC,
        }
      ],
      natGateways: 0,
    });

    const sg = new SecurityGroup(this, 'FargateSG', {
      securityGroupName: `${this.prefix}-ingestion-worker-sg`,
      description: 'Network Security Group for Fargate Ingestion Worker',
      vpc: this.vpc,
    });

    //
    // ECS & Fargate
    //
    // Setup the ECS cluster and Fargate Task
    this.ecsCluster = new Cluster(this, 'EcsCluser', {
      clusterName: `${this.prefix}-ingestion-worker-cluster`,
      vpc: this.vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });

    // Setup the CloudWatch Log Group
    this.fargateLogGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `${props.prefix}-ingestion-worker`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Setup the Fargate Task on ECS
    const taskRole = new Role(this, 'EcsTaskRole', {
      roleName: `${this.prefix}-ecs-service-role`,
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    taskRole.attachInlinePolicy(new Policy(this, 'EcsTaskPolicy', {
      policyName: `${this.prefix}-ecs-execution-policy`,
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['events:PutEvents'],
            resources: [props.eventBusArn],
          }),
        ],
      })
    }));

    const fargateTask = new FargateTaskDefinition(this, 'FargateTaskDefinition', {
      memoryLimitMiB: props.workerMemoryMiB || 512,
      cpu: props.workerCpu || 256,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
      taskRole: taskRole
    });
    this.fargateTask = fargateTask;

    fargateTask.addContainer('FargateContainer', {
      containerName: `${this.prefix}-ingestion-worker`,
      image: ContainerImage.fromEcrRepository(props.ecrRepo, 'latest'),
      environment: {
        'EVENT_BUS_NAME': props.eventBusName,
        'EVENT_DETAIL_TYPE': props.eventDetailType,
        'KINESIS_FIREHOSE_ARN': props.kinesisFirehoseArn,
        'INGESTION_INTERVAL': this.ingestionIntervalMSec.toString(),
      },
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'node healthcheck.js || exit 1'],
        interval: Duration.seconds(30),
        retries: 3,
        startPeriod: Duration.seconds(30),
        timeout: Duration.seconds(5),
      },
      logging: LogDrivers.awsLogs({ 
        logGroup: this.fargateLogGroup,
        streamPrefix: `${props.prefix}-ingestion-worker-`,
      })
    });
    
    // Setup the worker Fargate Service
    this.fargateService = new FargateService(this, 'FargateService', {
      serviceName: `${this.prefix}-ingestion-service`,
      cluster: this.ecsCluster,
      assignPublicIp: true,
      securityGroups: [ sg ],
      taskDefinition: fargateTask,
      desiredCount: 0,
      circuitBreaker: { rollback: true },
    });
  }
}