# This code is based on 
# https://github.com/aws-samples/amazon-sagemaker-feature-store-streaming-aggregation/blob/main/src/lambda/StreamingIngestAggFeatures/lambda_function.py
import json
import base64
import subprocess
import os
import sys
from datetime import datetime
import time

import boto3
from aws_lambda_powertools import Logger, Tracer

logger = Logger()
tracer = Tracer()

AGG_FEATURE_GROUP_NAME = os.environ.get("AGG_FEATURE_GROUP_NAME")

try:
    sm = boto3.Session().client(service_name="sagemaker")
    sm_fs = boto3.Session().client(service_name="sagemaker-featurestore-runtime")
except:
    logger.error("Failed while connecting to SageMaker Feature Store")
    logger.error(f"Unexpected error: {sys.exc_info()[0]}")

@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler()
def lambda_handler(event, context):
    records = event["records"]
    logger.info(f"Processing {len(records)} records")
    
    agg_records = []
    for rec in records:
        data = rec['data']
        agg_data_str = base64.b64decode(data) 
        agg_data = json.loads(agg_data_str)
        
        total_nb_trx_1h = agg_data['total_nb_trx_1h']
        total_fee_1h = agg_data['total_fee_1h']
        avg_fee_1h = agg_data['avg_fee_1h']

        logger.info(f"Aggregated transaction data over the past hour, total_nb_trx_1h: {total_nb_trx_1h}, total_fee_1h: {total_fee_1h}, avg_fee_1h: {avg_fee_1h}")
        update_agg(AGG_FEATURE_GROUP_NAME, total_nb_trx_1h, total_fee_1h, avg_fee_1h)
        
        # Flag each record as being "Ok", so that Kinesis won't try to re-send 
        agg_records.append({'recordId': rec['recordId'],
                            'result': 'Ok'})
    return {'records': agg_records}

def update_agg(fg_name, total_nb_trx_1h, total_fee_1h, avg_fee_1h):
    record = [{'FeatureName':'total_nb_trx_1h', 'ValueAsString': str(total_nb_trx_1h)},
              {'FeatureName':'total_fee_1h', 'ValueAsString': str(total_fee_1h)},
              {'FeatureName':'avg_fee_1h', 'ValueAsString': str(avg_fee_1h)},
              {'FeatureName':'trx_time', 'ValueAsString': str(int(round(time.time())))} #datetime.now().isoformat()} #
             ]
    sm_fs.put_record(FeatureGroupName=fg_name, Record=record)
    return