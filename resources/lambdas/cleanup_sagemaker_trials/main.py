import boto3
import os
from aws_lambda_powertools import Logger

logger = Logger()
tracer = Tracer()
ssm = boto3.client("ssm")
sm = boto3.client("sagemaker")
sts = boto3.client("sts")
AWS_REGION = boto3.session.Session().region_name
ACCOUNT_ID = sts.get_caller_identity().get("Account")

@logger.inject_lambda_context(log_event=True)
@tracer.capture_lambda_handler()
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
    next_token = None
    experiments = []
    sagemaker_arn_prefix = f"arn:aws:sagemaker:{AWS_REGION}:{ACCOUNT_ID}"
    while True:
        response = sm.list_experiments(
            SortBy="CreationTime",
            SortOrder="Descending",
            NextToken=next_token,
        )
        for experiment in response.get("ExperimentSummaries"):
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
        next_token = response.get("NextToken")
        if not next_token:
            break
    logger.info(f"Found {len(experiments)} experiments to delete")
    for experiment in experiments:
        sm.delete_experiment(ExperimentName=experiment.get("ExperimentName"))
        logger.info(f"Deleted experiment {experiment.get('ExperimentName')}")
    # get the trials of the experiments
    for experiment in experiments:
        trials = sm.list_trials(ExperimentName=experiment.get("ExperimentName")).get("TrialSummaries")
        for trial in trials:
            trial_components = sm.list_trial_components(TrialName=trial.get("TrialName")).get("TrialComponentSummaries")
            for trial_component in trial_components:
                sm.delete_trial_component(TrialComponentName=trial_component.get("TrialComponentName"))
                logger.info(f"Deleted trial {trial.get('TrialName')} component {trial_component.get('TrialComponentName')}")
            sm.delete_trial(TrialName=trial.get("TrialName"))
            logger.info(f"Deleted trial {trial.get('TrialName')}")
        sm.delete_experiment(ExperimentName=experiment.get("ExperimentName"))
        logger.info(f"Deleted experiment {experiment.get('ExperimentName')}")
