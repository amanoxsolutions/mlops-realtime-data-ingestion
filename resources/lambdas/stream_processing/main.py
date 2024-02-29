import base64
import io
import json
import os
import time

from datetime import timedelta

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from boto3.dynamodb.conditions import Attr

logger = Logger()
tracer = Tracer()

DYNAMODB_SEEN_TABLE_NAME = os.environ.get("DYNAMODB_SEEN_TABLE_NAME")
HASH_KEY_NAME = os.environ.get("HASH_KEY_NAME")
TTL_ATTRIBUTE_NAME = os.environ.get("TTL_ATTRIBUTE_NAME")
DDB_ITEM_TTL_HOURS = int(os.environ.get("DDB_ITEM_TTL_HOURS"))

# TODO introduce boto3 session retry-config
dynamodb_resource = boto3.resource("dynamodb")

table_of_seen_items = dynamodb_resource.Table(DYNAMODB_SEEN_TABLE_NAME)
""" :type: pyboto3.dynamodb.resources.Table """

# @logger.inject_lambda_context(log_event=True)
# We need to set capture_response=False due the large return payload to avoid "Message Too Long" error
# from the tracer. Refer to https://github.com/awslabs/aws-lambda-powertools-python/issues/476
@tracer.capture_lambda_handler(capture_response=False)
def lambda_handler(event, context):
    record_results = []
    for raw_record in event["records"]:
        raw_data = raw_record["data"]
        # base64 decode the data and load the JSON data
        record = json.loads(base64.b64decode(raw_data))
        transactions_to_store = []
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
                transactions_to_store.append(transaction)
        logger.info(f"Added  {len(transactions_to_store)} transactions out of {len(record['detail']['txs'])} from the stream block payload.")
        record_results.append({
            "recordId": raw_record["recordId"],
            "result": "Ok",
            "data": base64.b64encode(json.dumps(transactions_to_store).encode("utf-8"))
        })
    return { "records": record_results}  # TODO validate needed record_results format
