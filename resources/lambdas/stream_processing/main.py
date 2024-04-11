import base64
import json
import os
import time
import boto3
from datetime import timedelta
from aws_lambda_powertools import Logger, Tracer
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

logger = Logger()
tracer = Tracer()

DYNAMODB_SEEN_TABLE_NAME = os.environ.get("DYNAMODB_SEEN_TABLE_NAME")
HASH_KEY_NAME = os.environ.get("HASH_KEY_NAME")
TTL_ATTRIBUTE_NAME = os.environ.get("TTL_ATTRIBUTE_NAME")
DDB_ITEM_TTL_HOURS = int(os.environ.get("DDB_ITEM_TTL_HOURS"))
KINESIS_DATASTREAM_NAME = os.environ.get("KINESIS_DATASTREAM_NAME")

# TODO introduce boto3 session retry-config
dynamodb_resource = boto3.resource("dynamodb")
kinesis = boto3.client("kinesis")

table_of_seen_items = dynamodb_resource.Table(DYNAMODB_SEEN_TABLE_NAME)
""" :type: pyboto3.dynamodb.resources.Table """

# @logger.inject_lambda_context(log_event=True)
# We need to set capture_response=False due the large return payload to avoid "Message Too Long" error
# from the tracer. Refer to https://github.com/awslabs/aws-lambda-powertools-python/issues/476
@tracer.capture_lambda_handler(capture_response=False)
def lambda_handler(event, context):
    for raw_record in event["Records"]:
        raw_data = raw_record['kinesis']["data"]
        # base64 decode the data and load the JSON data
        record = json.loads(base64.b64decode(raw_data))
        transactions_to_keep = []
        logger.info(f"Processing block of {len(record['detail']['txs'])} transactions.")
        for transaction in record["detail"]["txs"]:
            transaction_hash = transaction[HASH_KEY_NAME]

            # only create item if it does not exist
            # https://stackoverflow.com/a/55110463/429162
            try:
                #[2022-12-20 21:20] David Horvath
#https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/dynamodb.html#DynamoDB.Table.put_item
#
#[2022-12-20 21:20] David Horvath
#To prevent a new item from replacing an existing item, use a conditional expression that contains the attribute_not_exists function with the name of the attribute being used as the partition key for the table. Since every record must contain that attribute, the attribute_not_exists function will only succeed if no matching item exists.


                table_of_seen_items.put_item(
                    Item={
                        HASH_KEY_NAME: transaction_hash,
                        TTL_ATTRIBUTE_NAME: int(time.time() + timedelta(hours=DDB_ITEM_TTL_HOURS).total_seconds())
                    },
                    ConditionExpression=Attr(HASH_KEY_NAME).not_exists()
                )
            except dynamodb_resource.meta.client.exceptions.ConditionalCheckFailedException:
                logger.info(f"been there seen that: {transaction_hash}")
            else:
                # Prepare the records for the Kinesis Data Stream
                transactions_to_keep.append({
                    "Data": json.dumps(transaction),
                    "PartitionKey": transaction_hash
                })
        logger.info(f"Added {len(transactions_to_keep)} transactions out of {len(record['detail']['txs'])} from the stream block payload.")
        # send the processed records to the Kinesis Data Stream
        try:
            kinesis.put_records(
                StreamName=KINESIS_DATASTREAM_NAME,
                Records=transactions_to_keep
            )
        except ClientError as e:
            logger.exception("Failed to put records to Kinesis Data Stream.")
            logger.exception({"records": transactions_to_keep})
