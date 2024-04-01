import boto3
import os
import concurrent.futures
from aws_lambda_powertools import Logger
from typing import Dict

logger = Logger()
ssm = boto3.client("ssm")
sm = boto3.client("sagemaker")
sts = boto3.client("sts")
AWS_REGION = boto3.session.Session().region_name
ACCOUNT_ID = sts.get_caller_identity().get("Account")

@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    # Get the SageMaker prefix name from SSM parameter store
    project_prefix = ssm.get_parameter(Name="/rdi-mlops/stack-parameters/project-prefix").get("Parameter").get("Value")
    # List all the sagemaker experiments where the ExperimentSource.SourceArn starts with either
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:pipeline/blockchainforecastpipeline
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:pipeline/modelmonitordataingestion
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:pipeline/sagemaker-model-monitoring-dataingestion
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:pipeline/{project_prefix}-
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:hyper-parameter-tuning-job/deepar-tuning
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:hyper-parameter-tuning-job/{project_prefix}-
    experiments = []
    sagemaker_arn_prefix = f"arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}"
    paginator = sm.get_paginator("list_experiments")
    for page in paginator.paginate():
        for experiment in page["ExperimentSummaries"]:
            if experiment["ExperimentSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:pipeline/blockchainforecastpipeline"
            ) or experiment["ExperimentSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:pipeline/modelmonitordataingestion"
            ) or experiment["ExperimentSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:pipeline/sagemaker-model-monitoring-dataingestion"
            ) or experiment["ExperimentSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:pipeline/{project_prefix}"
            ) or experiment["ExperimentSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:hyper-parameter-tuning-job/deepar-tuning"
            ) or experiment["ExperimentSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:hyper-parameter-tuning-job/{project_prefix}"
            ):
                experiments.append(experiment)
    logger.info(f"Found {len(experiments)} experiments to delete")
    # Delete all experiments in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        executor.map(delete_experiment, experiments)
    return {}

def delete_experiment(experiment: Dict):
    sm.delete_experiment(ExperimentName=experiment.get("ExperimentName"))
    logger.info(f"Deleted experiment {experiment.get('ExperimentName')}")
