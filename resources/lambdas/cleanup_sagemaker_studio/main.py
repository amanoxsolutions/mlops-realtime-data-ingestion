import os
import boto3
import logging
import time
import lib.cfnresponse as cfnresponse
from typing import Dict, List, Tuple

logger = logging.getLogger()
logger.setLevel(logging.INFO)
sagemaker = boto3.client("sagemaker")

SAGEMAKER_DOMAIN_ID = os.environ["SAGEMAKER_DOMAIN_ID"]
SAGEMAKER_USER_PROFILE = os.environ["SAGEMAKER_USER_PROFILE"]
SAGEMAKER_APP_NAME = os.environ["SAGEMAKER_APP_NAME"]
PHYSICAL_ID = os.environ["PHYSICAL_ID"]

def lambda_handler(event, context):
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        if request == "delete":
            delete_sagemaker_studio_apps(SAGEMAKER_DOMAIN_ID)
            wait_studio_app_deletion(SAGEMAKER_DOMAIN_ID)
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

def delete_sagemaker_studio_apps(domain_id: str):
    """List and delete all the SageMaker Studio apps for the domain and user profile
    escept the one created by the CDK SageMaker stack.

    Args:
        domain_id (str): the SageMaker domain ID
    """
    apps = get_sagemaker_studio_apps(domain_id)
    if not apps:
        logger.info(f"No SageMaker Studio apps found for the domain {SAGEMAKER_DOMAIN_ID}")
        return
    logger.info(f"Deleting all the user created SageMaker Studio apps for the domain {SAGEMAKER_DOMAIN_ID}")
    for app in apps:
        app_name = app.get("AppName")
        status = app.get("Status")
        # The app created by the SageMaker stack will be automatically destroyed
        # Here we are deleting the apps created by the user if they are not already deleted or being deleted
        if app_name != SAGEMAKER_APP_NAME and status != "Deleting" and status != "Deleted":
            logger.info(f"Deleting the user created SageMaker Studio app {app_name}")
            sagemaker.delete_app(
                DomainId=domain_id,
                UserProfileName=SAGEMAKER_USER_PROFILE,
                AppName=app_name,
                AppType=app.get("AppType")
            )


def wait_studio_app_deletion(domain_id: str):
    """Wait until all the SageMaker Studio apps are deleted.

    Args:
        domain_id (str): the SageMaker domain ID
        app_names (List[str]): the list of SageMaker Studio app names
    """
    # List all the apps in the domain
    apps = get_sagemaker_studio_apps(domain_id)
    if not apps:
        logger.info(f"No SageMaker Studio apps found for the domain {SAGEMAKER_DOMAIN_ID}")
        return
    logger.info(f"Waiting for the SageMaker Studio apps og the domain {domain_id} to be deleted")
    all_apps_deleted = False
    # Wait until all apps are deleted
    while not all_apps_deleted:
        all_apps_deleted = True
        # For each app in the SageMaker domain, check if it is deleted
        for app in apps:
            app_name = app.get("AppName")
            response = sagemaker.describe_app(
                DomainId=domain_id,
                UserProfileName=SAGEMAKER_USER_PROFILE,
                AppName=app_name,
                AppType=app.get("AppType")
            )
            status = response.get("Status")
            if status == "Deleting":
                logger.info(f"SageMaker Studio app {app_name} is still being deleted")
                all_apps_deleted = False
            elif status == "Deleted":
                logger.info(f"SageMaker Studio app {app_name} is deleted")
            else:
                logger.error(f"SageMaker Studio app {app_name} is in status {status}. It should be either in a 'Deleting' or 'Deleted' state.")
        if not all_apps_deleted:
            time.sleep(10)
