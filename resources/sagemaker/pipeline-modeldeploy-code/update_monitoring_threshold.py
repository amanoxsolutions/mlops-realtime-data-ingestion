import argparse
import json
import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
sm_client = boto3.client("sagemaker")
s3_client = boto3.client("s3")
ssm_client = boto3.client("ssm")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sagemaker-project-id", type=str, required=True)
    parser.add_argument("--sagemaker-project-name", type=str, required=True)
    args, _ = parser.parse_known_args()

    model_pipeline_name = f"{args.sagemaker_project_name}-{args.sagemaker_project_id}"
    # Get the last execution ID of the SageMaker Model Building Pipeline
    try:
        response = sm_client.list_pipeline_executions(
            PipelineName=model_pipeline_name,
            SortOrder="Descending",
        )
        last_execution_id = response["PipelineExecutionSummaries"][0]["PipelineExecutionArn"].split("/")[-1]
        logger.info(f"Last execution ID: {last_execution_id}")
    except ClientError as e:
        logger.error(f"An error occurred: {e}")
        raise e
    try:
        # Read the Evaluation output from the SageMaker Model Building Pipeline
        # Of the last execution ID which is stored in S3
        bucket = f"sagemaker-project-{args.sagemaker_project_id}"
        object_key = f"{model_pipeline_name}/{last_execution_id}/EvaluateModel/output/evaluation/evaluation.json"
        response = s3_client.get_object(Bucket=bucket, Key=object_key)
        evaluation_output = json.loads(response["Body"].read())
        logger.info(f"Model evaluation output: {evaluation_output}")
        mean_quantile_loss_value = evaluation_output["deepar_metrics"]["mean_quantile_loss"]["value"]
        # Read the SSM Parameters storing the model validation thresholds by the parameters path
        model_validation_thresholds = {}
        response = ssm_client.get_parameters_by_path(
            Path="/rdi-mlops/sagemaker/model-build/validation-threshold",
            Recursive=False,
            WithDecryption=False,
        )
        for param in response["Parameters"]:
            model_validation_thresholds[param["Name"].split("/")[-1]] = float(param["Value"])
        # Update the threshold stored in the SSM Parameter Store if the threshold is lower
        if mean_quantile_loss_value < model_validation_thresholds["mean_quantile_loss"]:
            ssm_client.put_parameter(
                Name=f"/rdi-mlops/sagemaker/model-build/validation-threshold/mean_quantile_loss",
                Description=f"Model build pipeline parameter for validation-threshold/mean_quantile_loss",
                Value=f"{mean_quantile_loss_value:.4f}",
                Type="String",
                Overwrite=True,
            )
            logger.info(f"Updated model validation threshold in SSM parameter /rdi-mlops/sagemaker/model-build/validation-threshold/mean_quantile_loss to: {mean_quantile_loss_value:.3f}")
    except ClientError as e:
        logger.error(f"An error occurred: {e}")
        raise e

