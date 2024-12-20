# This code is based on
# https://github.com/aws-samples/amazon-sagemaker-feature-store-streaming-aggregation/blob/main/src/lambda/StreamingIngestAggFeatures/lambda_function.py
import json
import base64
import sys
import os
import time
import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger, Tracer

logger = Logger()
tracer = Tracer()

AGG_FEATURE_GROUP_NAME = os.environ.get("AGG_FEATURE_GROUP_NAME")

try:
    sm = boto3.Session().client(service_name="sagemaker")
    sm_fs = boto3.Session().client(service_name="sagemaker-featurestore-runtime")
except ClientError:
    logger.error("Failed while connecting to SageMaker Feature Store")
    logger.error(f"Unexpected error: {sys.exc_info()[0]}")


@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler()
def lambda_handler(event, context):
    records = event.get("Records")
    logger.info(f"Processing {len(records)} records")

    # Read the records from Kinesis Data Stream
    for rec in records:
        data = rec.get("kinesis").get("data")
        agg_data_str = base64.b64decode(data)
        agg_data = json.loads(agg_data_str)

        tx_minute = agg_data["tx_minute"]
        total_nb_trx_1min = agg_data["total_nb_trx_1min"]
        total_fee_1min = agg_data["total_fee_1min"]
        avg_fee_1min = agg_data["avg_fee_1min"]

        logger.info(
            f"Aggregated transaction data over the minute {tx_minute}, total_nb_trx_1min: {total_nb_trx_1min}, total_fee_1min: {total_fee_1min}, avg_fee_1min: {avg_fee_1min}"
        )
        update_agg(
            AGG_FEATURE_GROUP_NAME,
            tx_minute,
            total_nb_trx_1min,
            total_fee_1min,
            avg_fee_1min,
        )


def update_agg(fg_name, tx_minute, total_nb_trx_1min, total_fee_1min, avg_fee_1min):
    record = [
        {"FeatureName": "tx_minute", "ValueAsString": tx_minute},
        {"FeatureName": "total_nb_trx_1min", "ValueAsString": str(total_nb_trx_1min)},
        {"FeatureName": "total_fee_1min", "ValueAsString": str(total_fee_1min)},
        {"FeatureName": "avg_fee_1min", "ValueAsString": str(avg_fee_1min)},
        {"FeatureName": "event_time", "ValueAsString": str(int(round(time.time())))},
    ]
    sm_fs.put_record(FeatureGroupName=fg_name, Record=record)
    return
