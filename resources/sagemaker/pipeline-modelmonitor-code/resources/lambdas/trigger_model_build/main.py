import boto3
import botocore
import os

SAGEMAKER_PROJECT_NAME = os.environ["SAGEMAKER_PROJECT_NAME"]
SAGEMAKER_PROJECT_ID = os.environ["SAGEMAKER_PROJECT_ID"]

cp_client = boto3.client("codepipeline")


# Create a Lambda Function which will trigger the Model Building Pipeline
def lambda_handler(_, __):
    # Trigger the Code Pipeline of the model build
    pipeline_name = f"sagemaker-{SAGEMAKER_PROJECT_NAME}-{SAGEMAKER_PROJECT_ID}-modelbuild"
    try:
        response = cp_client.start_pipeline_execution(name=pipeline_name)
        print(f"Triggered the pipeline {pipeline_name} with execution id {response['pipelineExecutionId']}")
    except botocore.exceptions.ClientError as error:
        print(f"Error triggering the pipeline {pipeline_name}: {error}")
        raise error