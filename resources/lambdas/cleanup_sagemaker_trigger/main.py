import os
import boto3
import logging
import json
import lib.cfnresponse as cfnresponse

from typing import List, Dict

logger = logging.getLogger()
logger.setLevel(logging.INFO)
stepfunctions = boto3.client('stepfunctions')
sagemaker = boto3.client("sagemaker")

SAGEMAKER_DOMAIN_ID = os.environ["SAGEMAKER_DOMAIN_ID"]
SAGEMAKER_USER_PROFILE = os.environ["SAGEMAKER_USER_PROFILE"]
SAGEMAKER_APP_NAME = os.environ["SAGEMAKER_APP_NAME"]
PHYSICAL_ID = os.environ["PHYSICAL_ID"]
STEP_FUNCTION_ARN = os.environ["STEP_FUNCTION_ARN"]
CF_CALLBACK_URL = os.environ["CF_CALLBACK_URL"]

def lambda_handler(event, context):
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        if request == "delete":
            # Launch the deletion of the SageMaker Studio apps
            apps = delete_sagemaker_studio_apps(SAGEMAKER_DOMAIN_ID)
            # Launch the Step Function to wait for the deletion of the SageMaker Studio apps
            stepfunctions.start_execution(
                stateMachineArn=STEP_FUNCTION_ARN,
                input=json.dumps({
                    "sagemaker_domain_id": SAGEMAKER_DOMAIN_ID,
                    "sagemaker_user_profile": SAGEMAKER_USER_PROFILE,
                    "sagemaker_user_apps": apps,
                    "status": "DELETING",
                    "cf_callback_url": CF_CALLBACK_URL})
            )
        else:
            # Id we are not deleting the stack, we don't need to do anything,
            # so we just send a SUCCESS response to CloudFormation
            logger.info("No action required")
            stepfunctions.start_execution(
                stateMachineArn=STEP_FUNCTION_ARN,
                input=json.dumps({
                    "sagemaker_domain_id": SAGEMAKER_DOMAIN_ID,
                    "sagemaker_user_profile": SAGEMAKER_USER_PROFILE,
                    "sagemaker_user_apps": "",
                    "status": "SUCCESS",
                    "cf_callback_url": CF_CALLBACK_URL})
            )
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physicalResourceId=PHYSICAL_ID)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physicalResourceId=PHYSICAL_ID)


def get_sagemaker_studio_apps(domain_id: str) -> List[Dict]:
    """List all the SageMaker Studio apps for the domain and user profile.

    Args:
        domain_id (str): the SageMaker domain ID

    Returns:
        List[Dict]: the list of SageMaker Studio apps
    """
    logger.info(f"Listing all the SageMaker Studio apps for the domain {SAGEMAKER_DOMAIN_ID}")
    # List all the SageMaker apps for the domain and user profile
    response = sagemaker.list_apps(
        DomainIdEquals=domain_id,
        UserProfileNameEquals=SAGEMAKER_USER_PROFILE
    )
    apps = response.get("Apps")
    next_token = response.get("NextToken")
    while next_token:
        response = sagemaker.list_apps(
            DomainIdEquals=domain_id,
            UserProfileNameEquals=SAGEMAKER_USER_PROFILE,
            NextToken=next_token
        )
        apps.extend(response.get("Apps"))
        next_token = response.get("NextToken")
    logger.info(f"Found {len(apps)} SageMaker Studio apps")
    for app in apps:
        logger.info(f"SageMaker Studio app: {app.get('AppName')}")
    return apps


def delete_sagemaker_studio_apps(domain_id: str) -> List[Dict]:
    """List and delete all the SageMaker Studio apps for the domain and user profile
    escept the one created by the CDK SageMaker stack.

    Args:
        domain_id (str): the SageMaker domain ID

    Returns:
        List[Dict]: the list of SageMaker Studio apps
    """
    apps = get_sagemaker_studio_apps(domain_id)
    apps_list = []
    if not apps:
        logger.info(f"No SageMaker Studio apps found for the domain {SAGEMAKER_DOMAIN_ID}")
        return apps_list
    logger.info(f"Deleting all the user created SageMaker Studio apps for the domain {SAGEMAKER_DOMAIN_ID}")
    for app in apps:
        app_name = app.get("AppName")
        status = app.get("Status")
        type = app.get("AppType")
        apps_list.append({"name": app_name, "type": type})
        # The app created by the SageMaker stack will be automatically destroyed
        # Here we are deleting the apps created by the user if they are not already deleted or being deleted
        if app_name != SAGEMAKER_APP_NAME and status != "Deleting" and status != "Deleted":
            logger.info(f"Deleting the user created SageMaker Studio app {app_name}")
            sagemaker.delete_app(
                DomainId=domain_id,
                UserProfileName=SAGEMAKER_USER_PROFILE,
                AppName=app_name,
                AppType=type
            )
    return apps_list
    