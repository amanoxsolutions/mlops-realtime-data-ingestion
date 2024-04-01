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
    # List all the pipelines executions and for each pipeline, use the pipeline execution arn
    # to retrieve the execution trial name
    execution_arns = []
    for pipeline in pipelines:
        paginator = sm.get_paginator("list_pipeline_executions")
        for page in paginator.paginate(PipelineName=pipeline.get("PipelineName")):
            for execution in page["PipelineExecutionSummaries"]:
                execution_arns.append(execution["PipelineExecutionArn"])
    executions_trial_names = []
    for execution_arn in execution_arns:
        response = sm.describe_pipeline_execution(PipelineExecutionArn=execution_arn)
        executions_trial_names.append(response.get("PipelineExperimentConfig").get("TrialName"))
    # List all the SageMaker models, which ModelName contains an execution trial name
    model_names = []
    paginator = sm.get_paginator("list_models")
    for page in paginator.paginate():
        for model in page["Models"]:
            for trial_name in executions_trial_names:
                if trial_name in model["ModelName"]:
                    model_names.append(model["ModelName"])
    logger.info(f"Found {len(model_names)} models to delete")
    # Delete all the models in the list
    for model_name in model_names:
        sm.delete_model(ModelName=model_name)
        logger.info(f"Deleted model {model_name}")
