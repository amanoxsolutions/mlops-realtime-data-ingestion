import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { Duration } from 'aws-cdk-lib';
import {
  IRole,
  ManagedPolicy,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
  Code,
  Function,
  IAlias,
  IFunction,
  ILayerVersion,
  Runtime,
  Architecture,
  Tracing,
  VersionOptions,
} from 'aws-cdk-lib/aws-lambda';
import {  ILogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

interface LambdaFunctionProps {
  functionName: string;
  runtime: Runtime;
  handler: string;
  code: Code;
  logRetention: RetentionDays;
  tracing: Tracing;
  timeout?: Duration;
  memorySize?: number;
  architecture: Architecture;
  layers?: ILayerVersion[];
  role?: IRole;
  environment?: { [key: string]: string };
  currentVersionOptions?: VersionOptions;
}

interface RDILambdaProps {
  readonly prefix: string;
  readonly name: string;
  readonly codePath: string;
  readonly role?: IRole;
  readonly timeout?: Duration;
  readonly memorySize?: number;
  readonly runtime?: Runtime;
  readonly architecture?: Architecture;
  readonly additionalPolicyStatements?: PolicyStatement[];
  readonly environment?: { [key: string]: string };
  readonly hasLayer?: boolean;
}

export class RDILambda extends Construct {
  public readonly function: IFunction;
  public readonly alias: IAlias;
  public readonly logGroup: ILogGroup;
  public readonly prefix: string;
  public readonly name: string;
  public readonly codePath: string;
  public readonly role: IRole;
  public readonly properties: LambdaFunctionProps;

  constructor(scope: Construct, id: string, props: RDILambdaProps) {
    super(scope, id);

    this.prefix = props.prefix;
    this.name = props.name;
    this.codePath = props.codePath;
    const hasLayer = props.hasLayer || false;

    this.properties = {
      functionName: `${this.prefix}-${this.name}`,
      runtime: props.runtime || Runtime.PYTHON_3_9,
      architecture: props.architecture || Architecture.X86_64,
      handler: 'main.lambda_handler',
      code: Code.fromAsset(this.codePath),
      logRetention: RetentionDays.ONE_WEEK,
      tracing: Tracing.ACTIVE,
    };

    if (props.role) {
      this.properties.role = props.role;
    } else {
      this.role = new Role(this, 'lambdaRole', {
        roleName: `${this.prefix}-${this.name}-lambda-role`,
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      });
      this.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

      if (props.additionalPolicyStatements) {
        const policyDocument = new PolicyDocument({
          statements: props.additionalPolicyStatements,
        });
        new Policy(this, 'lambdaPolicy', {
          policyName: `${this.prefix}-${this.name}-policy`,
          document: policyDocument,
          roles: [this.role],
        });
        this.properties.role = this.role;
      }
    }

    if (props.timeout) {
      this.properties.timeout = props.timeout;
    }

    if (props.memorySize) {
      this.properties.memorySize = props.memorySize;
    }

    if (props.environment) {
      this.properties.environment = props.environment;
    }

    let layers: ILayerVersion[] = [];
    if (hasLayer) {
        layers = [
        new PythonLayerVersion(this, 'Layer', {
          entry: `${props.codePath}/layer`,
          description: `${this.prefix}-${this.name} Lambda Layer`,
          compatibleRuntimes: [this.properties.runtime],
        }),
      ];
    }

    const lambda = new Function(this, 'function', {
      ...this.properties,
      layers: layers,
    });
    this.function = lambda;
    this.logGroup = lambda.logGroup;
  }
}
