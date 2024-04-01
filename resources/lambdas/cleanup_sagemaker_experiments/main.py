import boto3
import os
from aws_lambda_powertools import Logger

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
    # List all the sagemaker trials where the TrialSource.SourceArn starts with either
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:training-job/deepar-tuning
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:training-job/{project_prefix}
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:pipeline/{project_prefix}
    # - arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}:pipeline/sagemaker-model-monitoring
    next_token = None
    trials = []
    sagemaker_arn_prefix = f"arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}"
    while True:
        response = sm.list_trials(
            SortBy="CreationTime",
            SortOrder="Descending",
            NextToken=next_token,
        )
        for trial in response.get("TrialSummaries"):
            if trial["TrialSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:training-job/deepar-tuning"
            ) or trial["TrialSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:training-job/{project_prefix}"
            ) or trial["TrialSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:pipeline/{project_prefix}"
            ) or trial["TrialSource"]["SourceArn"].startswith(
                f"{sagemaker_arn_prefix}:pipeline/sagemaker-model-monitoring"
            ):
                trials.append(trial)
        next_token = response.get("NextToken")
        if not next_token:
            break
    logger.info(f"Found {len(trials)} trials to delete")
    # For each trial get the trial components and delete them
    for trial in trials:
        trial_components = sm.list_trial_components(TrialName=trial.get("TrialName")).get("TrialComponentSummaries")
        for trial_component in trial_components:
            sm.delete_trial_component(TrialComponentName=trial_component.get("TrialComponentName"))
            logger.info(f"Deleted trial {trial.get('TrialName')} component {trial_component.get('TrialComponentName')}")
        sm.delete_trial(TrialName=trial.get("TrialName"))
        logger.info(f"Deleted trial {trial.get('TrialName')}")
