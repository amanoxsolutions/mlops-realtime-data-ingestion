import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Table, ITable, AttributeType } from 'aws-cdk-lib/aws-dynamodb';

export interface RDIDynamodbTableProps {
  readonly prefix: string;
  readonly removalPolicy: RemovalPolicy;
}

export class RDIDynamodbTable extends Construct {
    public readonly prefix: string;
    public readonly table: ITable;
    public readonly partitionKey: string;
    public readonly timeToLiveAttribute: string;
  
    constructor(scope: Construct, id: string, props: RDIDynamodbTableProps) {
      super(scope, id);
  
      this.prefix = props.prefix;
      this.partitionKey = 'hash';
      this.timeToLiveAttribute = 'expiration_time';
  
      this.table = new Table(this, 'table', {
        tableName: `${this.prefix}-input-hash`,
        partitionKey: { name: this.partitionKey, type: AttributeType.STRING },
        removalPolicy: props.removalPolicy,
        timeToLiveAttribute: this.timeToLiveAttribute,
      });
    }
  }