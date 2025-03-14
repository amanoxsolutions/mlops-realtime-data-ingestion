import argparse
import json
import logging
import boto3
from botocore.exceptions import ClientError
from utils import get_latest_approved_package

logger = logging.getLogger(__name__)
logging.basicConfig(encoding='utf-8', level=logging.INFO)
sm_client = boto3.client("sagemaker")
s3_client = boto3.client("s3")
ssm_client = boto3.client("ssm")


def get_ssm_parameters(param_path: str) -> dict[str, str]:
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


def update_model_threshold(model_package_group_name: str, model_pipeline_name: str, bucket: str) -> None:
    """Update the model validation threshold in the SSM Parameter Store if the threshold is lower
    than the current threshold stored in the SSM Parameter Store.

    Args:
        model_package_group_name (str): the name of the SageMaker model package group for the project
        model_pipeline_name (str): the name of the SageMaker Model Building Pipeline
        bucket (str): the name of the S3 bucket where the evaluation output is stored
    """
    # Get the execution ID of the last approved model
    try:
        # Get the latest approved package
        model_package_arn = get_latest_approved_package(model_package_group_name, sm_client)
        # Get the model package details
        package_details = sm_client.describe_model_package(ModelPackageName=model_package_arn)
        # Get the pipeline execution ID of the last approved model
        pipeline_execution_id = package_details["MetadataProperties"]["GeneratedBy"].split("/")[-1]
    except ClientError as e:
        logger.error(f"An error occurred: {e}")
        raise e
    try:
        # Read the Evaluation output from the SageMaker Model Building Pipeline
        # Of the last execution ID which is stored in S3
        object_key = f"{model_pipeline_name}/pipeline_executions/{pipeline_execution_id}/model_evaluation/evaluation.json"
        response = s3_client.get_object(Bucket=bucket, Key=object_key)
        evaluation_output = json.loads(response["Body"].read())
        logger.info(f"Model evaluation output: {evaluation_output}")
        weighted_quantile_loss_value = evaluation_output["deepar_metrics"][
            "weighted_quantile_loss"
        ]["value"]
        # Get the SSM parameters
        model_validation_thresholds = get_ssm_parameters(
            "/rdi-mlops/sagemaker/model-build/validation-threshold"
        )
        weighted_quantile_loss_threshold = float(
            model_validation_thresholds["weighted_quantile_loss"]
        )
        # We update parameters if the new model mean quantile loss is better than the current monitoring threshold
        if weighted_quantile_loss_value < weighted_quantile_loss_threshold:
            update_rate = float(model_validation_thresholds["update_rate"])
            threshold_update_step = abs(weighted_quantile_loss_value - weighted_quantile_loss_threshold) * update_rate
            new_threshold = weighted_quantile_loss_value + threshold_update_step 
            ssm_client.put_parameter(
                Name="/rdi-mlops/sagemaker/model-build/validation-threshold/weighted_quantile_loss",
                Description="Model build pipeline parameter for validation-threshold/weighted_quantile_loss",
                Value=f"{new_threshold:.4f}",
                Type="String",
                Overwrite=True,
            )
            logger.info(
                "Updated model validation threshold in SSM parameter /rdi-mlops/sagemaker/model-build/validation-threshold/weighted_quantile_loss to: {weighted_quantile_loss_value:.3f}"
            )
        # We update the current model accuarcy metric
        ssm_client.put_parameter(
            Name="/rdi-mlops/sagemaker/model-build/current-model-mean-weighted-quantile-loss",
            Description="Indicate whether the model has been trained once or not",
            Value=str(weighted_quantile_loss_value),
            Type="String",
            Overwrite=True,
        )
        logger.info(
            "Updated current model accuracy performance metric in SSM parameter /rdi-mlops/sagemaker/model-build/current-model-mean-weighted-quantile-loss to: {weighted_quantile_loss_value}"
        )
    except ClientError as e:
        logger.error(f"An error occurred: {e}")
        raise e


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sagemaker-project-id", type=str, required=True)
    parser.add_argument("--sagemaker-project-name", type=str, required=True)
    parser.add_argument("--model-package-group-name", type=str, required=True)
    args, _ = parser.parse_known_args()

    model_pipeline_name = f"{args.sagemaker_project_name}-model-training"
    bucket = f"sagemaker-project-{args.sagemaker_project_id}"
    update_model_threshold(args.model_package_group_name, model_pipeline_name, bucket)
