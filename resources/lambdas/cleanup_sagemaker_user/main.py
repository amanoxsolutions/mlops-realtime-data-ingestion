import boto3
import time
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from typing import List, Dict

helper = CfnResource()
logger = Logger()
sagemaker = boto3.client("sagemaker")


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)

@helper.create
@helper.update
def do_nothing(_, __):
    logger.info("Nothing to do")

@helper.delete
def delete(event, _):
    domain_id = event.get("ResourceProperties").get("DomainId")
    user_profile = event.get("ResourceProperties").get("StudioUserProfile")
    # Launch the deletion of the SageMaker Studio apps
    apps = delete_sagemaker_studio_apps(domain_id, user_profile)
    # Check if the apps are deleted
    status = "DELETING"
    while status == "DELETING":
        status = check_studio_app_deletion(domain_id, user_profile, apps)
        logger.info(f"Status of the SageMaker Studio apps deletion: {status}")
        time.sleep(30)

def delete_sagemaker_studio_apps(domain_id: str, user_profile: str) -> List[Dict]:
    """List and delete all the SageMaker Studio apps for the domain and user profile
    escept the one created by the CDK SageMaker stack.

    Args:
        domain_id (str): the SageMaker domain ID
        user_profile (str): the SageMaker Studio user profile name

    Returns:
        List[Dict]: the list of SageMaker Studio apps
    """
    apps = get_sagemaker_studio_apps(domain_id, user_profile)
    apps_list = []
    if not apps:
        logger.info(f"No SageMaker Studio apps found for the domain {domain_id}")
        return apps_list
    logger.info(f"Deleting all the user created SageMaker Studio apps for the domain {domain_id}")
    for app in apps:
        app_name = app.get("AppName")
        status = app.get("Status")
        type = app.get("AppType")
        apps_list.append({"name": app_name, "type": type})
        # We are deleting the apps created by the user if they are not already deleted or being deleted
        if status != "Deleting" and status != "Deleted":
            logger.info(f"Deleting the user created SageMaker Studio app {app_name}")
            sagemaker.delete_app(
                DomainId=domain_id,
                UserProfileName=user_profile,
                AppName=app_name,
                AppType=type
            )
    return apps_list

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

def get_sagemaker_studio_apps(domain_id: str, user_profile: str) -> List[Dict]:
    """List all the SageMaker Studio apps for the domain and user profile.

    Args:
        domain_id (str): the SageMaker domain ID
        user_profile (str): the SageMaker Studio user profile name

    Returns:
        List[Dict]: the list of SageMaker Studio apps
    """
    logger.info(f"Listing all the SageMaker Studio apps for the domain {domain_id}")
    # List all the SageMaker apps for the domain and user profile
    response = sagemaker.list_apps(
        DomainIdEquals=domain_id,
        UserProfileNameEquals=user_profile
    )
    apps = response.get("Apps")
    next_token = response.get("NextToken")
    while next_token:
        response = sagemaker.list_apps(
            DomainIdEquals=domain_id,
            UserProfileNameEquals=user_profile,
            NextToken=next_token
        )
        apps.extend(response.get("Apps"))
        next_token = response.get("NextToken")
    logger.info(f"Found {len(apps)} SageMaker Studio apps")
    for app in apps:
        logger.info(f"SageMaker Studio app: {app.get('AppName')}")
    return apps
