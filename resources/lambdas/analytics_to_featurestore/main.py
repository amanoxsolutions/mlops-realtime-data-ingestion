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

# @logger.inject_lambda_context(log_event=True)
# We need to set capture_response=False due the large return payload to avoid "Message Too Long" error
# from the tracer. Refer to https://github.com/awslabs/aws-lambda-powertools-python/issues/476
@tracer.capture_lambda_handler(capture_response=False)
def lambda_handler(event, context):
    records = event['records']
    return { "records": records }