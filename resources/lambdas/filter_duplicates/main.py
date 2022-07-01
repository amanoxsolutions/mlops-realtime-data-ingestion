import base64
import io
import json
import os

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from boto3.dynamodb.conditions import Attr

logger = Logger()
tracer = Tracer()

DYNAMODB_SEEN_TABLE_NAME = os.environ.get("DYNAMODB_SEEN_TABLE_NAME")
HASH_KEY_NAME = os.environ.get("HASH_KEY_NAME")

dynamodb_resource = boto3.resource("dynamodb")

table_of_seen_items = dynamodb_resource.Table(DYNAMODB_SEEN_TABLE_NAME)
""" :type: pyboto3.dynamodb.resources.Table """

@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    result = []
    for raw_record in event["Records"]:
        raw_data = raw_record["kinesis"]["data"]
        # base64 decode the data
        record = base64.b64decode(raw_data)
        event_hash = record[HASH_KEY_NAME]

        # TODO: mitigate failure case upon creation
        table_of_seen_items.put_item(Item={HASH_KEY_NAME: event_hash, "seen": 0})

        table_of_seen_items.update_item()
        try:
            # using write condition idempotence
            table_of_seen_items.update_item(
                Key={HASH_KEY_NAME: event_hash},
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
            result.append(record)
        return result  # TODO validate needed result format
