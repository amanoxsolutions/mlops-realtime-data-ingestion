import boto3
from aws_lambda_powertools import Logger

logger = Logger()
ssm = boto3.client("ssm")


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    # Define the parameters to delete
    parameters_to_delete = [
        "/rdi-mlops/sagemaker/model-build",
        "/rdi-mlops/stack-parameters/connection-arn",
    ]

    paginator = ssm.get_paginator("describe_parameters")

    # Loop through the parameters to check if they should be deleted
    for page in paginator.paginate():
        for param in page["Parameters"]:
            for prefix in parameters_to_delete:
                if param["Name"].startswith(prefix):
                    ssm.delete_parameter(Name=param["Name"])
                    logger.info(f"Deleted SSM parameter {param['Name']}")

    return {}
