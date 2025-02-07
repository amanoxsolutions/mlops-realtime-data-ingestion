import boto3
from botocore.config import Config
from aws_lambda_powertools import Logger
from botocore.exceptions import ClientError
import time

logger = Logger()
ssm = boto3.client("ssm")
sm = boto3.client(
    "sagemaker",
    config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 20}),
)


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    # Get the SageMaker prefix name from SSM parameter store
    project_prefix = (
        ssm.get_parameter(Name="/rdi-mlops/stack-parameters/project-prefix")
        .get("Parameter")
        .get("Value")
    )

    # List the SageMaker pipelines where the PipelineName starts with the project prefix
    pipelines = []
    paginator = sm.get_paginator("list_pipelines")
    for page in paginator.paginate():
        for pipeline in page["PipelineSummaries"]:
            if pipeline["PipelineName"].startswith(project_prefix):
                pipelines.append(pipeline)

    # List all the pipelines executions and retrieve execution trial names
    execution_arns = []
    for pipeline in pipelines:
        paginator = sm.get_paginator("list_pipeline_executions")
        for page in paginator.paginate(PipelineName=pipeline.get("PipelineName")):
            for execution in page["PipelineExecutionSummaries"]:
                execution_arns.append(execution["PipelineExecutionArn"])

    executions_trial_names = []
    for execution_arn in execution_arns:
        response = sm.describe_pipeline_execution(PipelineExecutionArn=execution_arn)
        executions_trial_names.append(
            response.get("PipelineExperimentConfig").get("TrialName")
        )

    # List all the SageMaker models that contain an execution trial name
    model_names = []
    paginator = sm.get_paginator("list_models")
    for page in paginator.paginate():
        for model in page["Models"]:
            for trial_name in executions_trial_names:
                if trial_name in model["ModelName"]:
                    model_names.append(model["ModelName"])

    logger.info(f"Found {len(model_names)} models to delete")

    # Delete all the models
    for model_name in model_names:
        sm.delete_model(ModelName=model_name)
        logger.info(f"Deleted model {model_name}")

    # List all the model package groups starting with the project prefix
    model_package_groups = []
    paginator = sm.get_paginator("list_model_package_groups")
    for page in paginator.paginate():
        for model_package_group in page["ModelPackageGroupSummaryList"]:
            if model_package_group["ModelPackageGroupName"].startswith(project_prefix):
                model_package_groups.append(model_package_group)

    logger.info(f"Found {len(model_package_groups)} model package groups to delete")

    # List all the model package versions for each model package group
    model_package_versions = []
    for model_package_group in model_package_groups:
        paginator = sm.get_paginator("list_model_packages")
        for page in paginator.paginate(
            ModelPackageGroupName=model_package_group["ModelPackageGroupName"]
        ):
            model_package_versions.extend(page["ModelPackageSummaryList"])

    logger.info(f"Found {len(model_package_versions)} model package versions to delete")

    # Delete all model package versions
    for model_package_version in model_package_versions:
        sm.delete_model_package(
            ModelPackageName=model_package_version["ModelPackageArn"]
        )
        logger.info(f"Deleted model package {model_package_version['ModelPackageArn']}")

    # Delete model package groups with retry on ValidationException
    for model_package_group in model_package_groups:
        retries = 3
        for attempt in range(retries):
            try:
                sm.delete_model_package_group(
                    ModelPackageGroupName=model_package_group["ModelPackageGroupName"]
                )
                logger.info(
                    f"Deleted model package group {model_package_group['ModelPackageGroupName']}"
                )
                break  # Exit the retry loop if successful
            except ClientError as e:
                if e.response["Error"]["Code"] == "ValidationException":
                    logger.warning(
                        f"Attempt {attempt + 1}: Failed to delete model package group due to validation exception: {e}"
                    )
                    time.sleep(2**attempt)  # Exponential backoff
                else:
                    logger.error(f"Failed to delete model package group: {e}")
                    break  # Exit on other errors

    return {}
