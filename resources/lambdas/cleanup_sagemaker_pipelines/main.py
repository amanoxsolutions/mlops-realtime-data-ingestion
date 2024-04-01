import boto3
from aws_lambda_powertools import Logger

logger = Logger()
ssm = boto3.client("ssm")
sm = boto3.client("sagemaker")

@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    # Get the SageMaker prefix name from SSM parameter store
    project_prefix = ssm.get_parameter(Name="/rdi-mlops/stack-parameters/project-prefix").get("Parameter").get("Value")
    # List the SageMaker pipelines where the PipelineName starts with the project prefix
    pipelines = []
    paginator = sm.get_paginator("list_pipelines")
    for page in paginator.paginate():
        for pipeline in page["PipelineSummaries"]:
            if pipeline["PipelineName"].startswith(project_prefix):
                pipelines.append(pipeline)
    # Delete all the remaining pipelines which name starts with the project prefix
    logger.info(f"Found {len(pipelines)} pipelines to delete")
    for pipeline in pipelines:
        sm.delete_pipeline(PipelineName=pipeline.get("PipelineName"))
        logger.info(f"Deleted pipeline {pipeline.get('PipelineName')}")
    return {}
