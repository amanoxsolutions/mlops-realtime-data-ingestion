import boto3
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()
ssm = boto3.client("ssm")


@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler()
def lambda_handler(event, context):
    # Delete all the SSM parameters with name starting with "/rdi-mlops/sagemaker/model-build"
    # which where configured outside the CDK infrastructure stack
    paginator = ssm.get_paginator("describe_parameters")
    for page in paginator.paginate():
        for param in page["Parameters"]:
            if param["Name"].startswith("/rdi-mlops/sagemaker/model-build"):
                ssm.delete_parameter(Name=param["Name"])
                logger.info(f"Deleted SSM parameter {param['Name']}")
