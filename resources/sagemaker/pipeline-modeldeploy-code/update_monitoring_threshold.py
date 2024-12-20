import argparse
import json
import logging
import boto3
from botocore.exceptions import ClientError
from typing import Dict

logger = logging.getLogger(__name__)
sm_client = boto3.client("sagemaker")
s3_client = boto3.client("s3")
ssm_client = boto3.client("ssm")


def get_ssm_parameters(param_path: str) -> Dict[str, str]:
    parameters = {}
    try:
        response = ssm_client.get_parameters_by_path(
            Path=param_path, Recursive=False, WithDecryption=False
        )
        for param in response["Parameters"]:
            parameters[param["Name"].split("/")[-1]] = param["Value"]
        while next_token := response.get("NextToken"):
            response = ssm_client.get_parameters_by_path(
                Path=param_path,
                Recursive=False,
                WithDecryption=False,
                NextToken=next_token,
            )
            for param in response["Parameters"]:
                parameters[param["Name"].split("/")[-1]] = param["Value"]
    except Exception as e:
        print(f"An error occurred reading the SSM stack parameters: {e}")
    return parameters


def update_model_threshold(model_pipeline_name: str, bucket: str) -> None:
    """Update the model validation threshold in the SSM Parameter Store if the threshold is lower
    than the current threshold stored in the SSM Parameter Store.

    Args:
        model_pipeline_name (str): the name of the SageMaker Model Building Pipeline
        bucket (str): the name of the S3 bucket where the evaluation output is stored
    """
    # Get the last execution ID of the SageMaker Model Building Pipeline
    try:
        response = sm_client.list_pipeline_executions(
            PipelineName=model_pipeline_name,
            SortOrder="Descending",
        )
        # If there are no executions, exit the function
        # In this case we keep the default threshold value in the SSM Parameter Store
        if not response.get("PipelineExecutionSummaries"):
            logger.info(f"No executions found for the pipeline: {model_pipeline_name}")
            return
        last_execution_id = response["PipelineExecutionSummaries"][0][
            "PipelineExecutionArn"
        ].split("/")[-1]
        logger.info(f"Last execution ID: {last_execution_id}")
    except ClientError as e:
        logger.error(f"An error occurred: {e}")
        raise e
    try:
        # Read the Evaluation output from the SageMaker Model Building Pipeline
        # Of the last execution ID which is stored in S3
        object_key = f"{model_pipeline_name}/{last_execution_id}/EvaluateModel/output/evaluation/evaluation.json"
        response = s3_client.get_object(Bucket=bucket, Key=object_key)
        evaluation_output = json.loads(response["Body"].read())
        logger.info(f"Model evaluation output: {evaluation_output}")
        weighted_quantile_loss_value = evaluation_output["deepar_metrics"][
            "weighted_quantile_loss"
        ]["value"]
        # Read the SSM Parameters storing the model validation thresholds by the parameters path
        model_validation_thresholds = get_ssm_parameters(
            "/rdi-mlops/sagemaker/model-build/validation-threshold"
        )
        weighted_quantile_loss_threshold = float(
            model_validation_thresholds["weighted_quantile_loss"]
        )
        # Update the threshold stored in the SSM Parameter Store if the threshold is lower
        if weighted_quantile_loss_value < weighted_quantile_loss_threshold:
            ssm_client.put_parameter(
                Name="/rdi-mlops/sagemaker/model-build/validation-threshold/weighted_quantile_loss",
                Description="Model build pipeline parameter for validation-threshold/weighted_quantile_loss",
                Value=f"{weighted_quantile_loss_value:.4f}",
                Type="String",
                Overwrite=True,
            )
            logger.info(
                "Updated model validation threshold in SSM parameter /rdi-mlops/sagemaker/model-build/validation-threshold/weighted_quantile_loss to: {weighted_quantile_loss_value:.3f}"
            )
    except ClientError as e:
        logger.error(f"An error occurred: {e}")
        raise e


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sagemaker-project-id", type=str, required=True)
    parser.add_argument("--sagemaker-project-name", type=str, required=True)
    args, _ = parser.parse_known_args()

    model_pipeline_name = f"{args.sagemaker_project_name}-{args.sagemaker_project_id}"
    bucket = f"sagemaker-project-{args.sagemaker_project_id}"
    update_model_threshold(model_pipeline_name, bucket)
