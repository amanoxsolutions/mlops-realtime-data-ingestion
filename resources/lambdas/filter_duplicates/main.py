import io
import json
import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer

logger = Logger()
tracer = Tracer()

@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler
def lambda_handler(event, context):
    logger.info("Do something Smart")
