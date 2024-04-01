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
    next_token = None
    pipelines = []
    while True:
        response = sm.list_pipelines(
            NextToken=next_token,
        )
        for pipeline in response.get("PipelineSummaries"):
            if pipeline["PipelineName"].startswith(project_prefix):
                pipelines.append(pipeline)
        next_token = response.get("NextToken")
        if not next_token:
            break
    # List all the pipelines executions and for each pipeline, use the pipeline execution arn
    # to retrieve the execution trial name
    execution_arns = []
    for pipeline in pipelines:
        next_token = None
        while True:
            response = sm.list_pipeline_executions(
                PipelineName=pipeline.get("PipelineName"),
                NextToken=next_token,
            )
            for execution in response.get("PipelineExecutionSummaries"):
                execution_arns.append(execution.get("PipelineExecutionArn"))
            next_token = response.get("NextToken")
            if not next_token:
                break
    executions_trial_names = []
    for execution_arn in execution_arns:
        response = sm.describe_pipeline_execution(PipelineExecutionArn=execution_arn)
        executions_trial_names.append(response.get("PipelineExperimentConfig").get("TrialName"))
    # List all the SageMaker models, which ModelName contains an execution trial name
    next_token = None
    model_names = []
    while True:
        response = sm.list_models(
            NextToken=next_token,
        )
        for model in response.get("Models"):
            for trial_name in executions_trial_names:
                if trial_name in model.get("ModelName"):
                    model_names.append(model.get("ModelName"))
        next_token = response.get("NextToken")
        if not next_token:
            break
