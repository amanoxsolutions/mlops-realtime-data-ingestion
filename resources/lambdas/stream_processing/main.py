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
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    result = []
    for raw_record in event["records"]:
        raw_data = raw_record["data"]
        # base64 decode the data and load the JSON data
        record = json.loads(base64.b64decode(raw_data))

        for transaction in record["detail"]["txs"]:
            transaction_hash = transaction[HASH_KEY_NAME]

            # only create item if it does not exist
            # https://stackoverflow.com/a/55110463/429162
            try:
                table_of_seen_items.put_item(
                    Item={
                        HASH_KEY_NAME: transaction_hash,
                        "seen": 0,
                        TTL_ATTRIBUTE_NAME: int(time.time() + timedelta(hours=DDB_ITEM_TTL_HOURS).total_seconds())
                    },
                    ConditionExpression=Attr(HASH_KEY_NAME).not_exists()
                )
            except dynamodb_resource.meta.client.exceptions.ConditionalCheckFailedException:
                # if ConditionExpression resolves to false, the query will return a 400 err
                continue

            try:
                # using write condition idempotence
                table_of_seen_items.update_item(
                    Key={HASH_KEY_NAME: transaction_hash},
                    ConditionExpression=Attr("seen").eq(0),
                    # Can not use both expression and non-expression parameters in the same request and we need ConditionExpression
                    UpdateExpression=f"SET seen=:val",
                    ExpressionAttributeValues={
                        ":val": 1
                    },
                    ReturnValues="UPDATED_NEW")
            except table_of_seen_items.meta.client.exceptions.ConditionalCheckFailedException as e:
                logger.exception("been there seen that")
            else:
                result.append(transaction)
            return result  # TODO validate needed result format
