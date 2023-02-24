import os
import boto3
import logging
import time
from typing import List, Dict

logger = logging.getLogger()
logger.setLevel(logging.INFO)
sagemaker = boto3.client("sagemaker")

def lambda_handler(event, context):
    try:
        logger.info(f"Event: {event}")
        status = event.get("status")
        if status != "SUCCESS" and status != "FAILED":
            domain_id = event.get("sagemaker_domain_id")
            user_profile = event.get("sagemaker_user_profile")
            apps = event.get("sagemaker_user_apps")
            # Check the status of the SageMaker Studio apps deletion
            status = check_studio_app_deletion(domain_id, user_profile, apps)
        event["status"] = status
    except Exception as e:
        logger.exception(e)
        event["status"] = "FAILED"
    return event 


def check_studio_app_deletion(domain_id: str, user_profile: str, apps: List[Dict]) -> str:
    """Check the status of the SageMaker Studio apps deletion.

    Args:
        domain_id (str): the SageMaker domain ID
        user_profile (str): the SageMaker user profile name
        apps (List[str]): the list of SageMaker Studio app names

    Returns:
        str: the status of the deletion
    """
    all_apps_deleted = True
    # For each app in the SageMaker domain, check if it is deleted
    for app in apps:
        app_name = app.get("name")
        app_type = app.get("type")
        response = sagemaker.describe_app(
            DomainId=domain_id,
            UserProfileName=user_profile,
            AppName=app_name,
            AppType=app_type
        )
        status = response.get("Status")
        if status == "Deleting":
            logger.info(f"SageMaker Studio app {app_name} is still being deleted")
            all_apps_deleted = False
        elif status == "Deleted":
            logger.info(f"SageMaker Studio app {app_name} is deleted")
        else:
            all_apps_deleted = False
            logger.error(f"SageMaker Studio app {app_name} is in status {status}. It should be either in a 'Deleting' or 'Deleted' state.")
    if all_apps_deleted:
        return "DELETED"
    else:
        return "DELETING"
