import * as path from 'path';
import { Construct } from 'constructs';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Role, PolicyStatement, Effect, AnyPrincipal, ServicePrincipal, Policy, PolicyDocument, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { LogGroup, ILogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Vpc, IVpc, SubnetType, SecurityGroup, InterfaceVpcEndpointAwsService, Port, Peer } from 'aws-cdk-lib/aws-ec2';
import { 
  Cluster, 
  ICluster, 
  ContainerImage, 
  FargateTaskDefinition, 
  IFargateTaskDefinition,
  CpuArchitecture,
  OperatingSystemFamily,
  Protocol,
  LogDrivers,
  FargateService,
  IFargateService,
 } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Repository, TagMutability, IRepository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecrdeploy from 'cdk-ecr-deployment';

interface RDIIngestionWorkerProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly workerCpu?: number;
  readonly workerMemoryMiB?: number;
  readonly vpcCider?: string;
  readonly eventBusArn: string;
  readonly ecrRepo: IRepository;
}

export class RDIIngestionWorker extends Construct {
  public readonly prefix: string;
  public readonly vpc: IVpc;
  public readonly ecsCluster: ICluster;
  public readonly fargateTask: IFargateTaskDefinition;
  public readonly fargateService: IFargateService;
  public readonly fargateLogGroup: ILogGroup;

  constructor(scope: Construct, id: string, props: RDIIngestionWorkerProps) {
    super(scope, id);

    this.prefix = props.prefix;

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
        cpuArchitecture: CpuArchitecture.X86_64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
      taskRole: taskRole
    });
    this.fargateTask = fargateTask;

    const workerContainer = fargateTask.addContainer('FargateContainer', {
      containerName: `${this.prefix}-ingestion-worker`,
      image: ContainerImage.fromEcrRepository(props.ecrRepo, 'latest'),
      //image: ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{
        containerPort: 3000,
        protocol: Protocol.TCP
      }],
      essential: true,
      // healthCheck: {
      //   command: ["CMD-SHELL", "curl -f http://localhost:3000/ || exit 1"],
      //   interval: Duration.seconds(30),
      //   retries: 3,
      //   startPeriod: Duration.seconds(30),
      //   timeout: Duration.seconds(5),
      // },
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
      desiredCount: 1,
      circuitBreaker: { rollback: true },
    });
  }
}