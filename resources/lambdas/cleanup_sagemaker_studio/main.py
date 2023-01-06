import os
import boto3
import logging
import lib.cfnresponse as cfnresponse
from typing import Dict, List, Tuple

logger = logging.getLogger()
logger.setLevel(logging.INFO)
sagemaker = boto3.client("sagemaker")

SAGEMAKER_DOMAIN_NAME = os.environ["SAGEMAKER_DOMAIN_NAME"]
SAGEMAKER_USER_PROFILE = os.environ["SAGEMAKER_USER_PROFILE"]
SAGEMAKER_APP_NAME = os.environ["SAGEMAKER_APP_NAME"]
PHYSICAL_ID = os.environ["PHYSICAL_ID"]

def lambda_handler(event, context):
    response_data = {"deletedImages": []}
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        if request == "delete":
            domain_id = get_sagemaker_domain_id()
            delete_sagemaker_studio_apps(domain_id)
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=PHYSICAL_ID)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physicalResourceId=PHYSICAL_ID)


def filter_domain(next_token: str = None) -> Tuple[str, str]:
    """Get the SageMaker Domains from the last page of the list and search for the domain name.

    Args:
        next_token (str, optional): the NextToken returned by the sagemaker list_domains function. Defaults to None.

    Returns:
        Tuple[str, str]: the domain ID and the NextToken
    """
    domain_id = None
    # List the SageMaker domains from the next token
    response = sagemaker.list_domains(NextToken=next_token)
    next_token = response.get("NextToken")
    domains = response.get("Domains")
    # Search for the domain name in the list of domains
    for domain in domains:
        if domain.get("DomainName") == SAGEMAKER_DOMAIN_NAME:
            domain_id = domain.get("DomainId")
            break
    return domain_id, next_token


def get_sagemaker_domain_id() -> str:
    """Get the ID of the SageMaker Studio domain.

    Returns:
        str: the SageMaker domain ID
    """
    logger.info("Looking for the SageMaker Studio ID")
    # List all the SageMaker domain
    domain_id, next_token = filter_domain()
    while not domain_id and next_token:
        domain_id, next_token = filter_domain(next_token)
        if domain_id:
            break
    if not domain_id:
        raise Exception(f"SageMaker Studio Domain {SAGEMAKER_DOMAIN_NAME} not found")
    logger.info(f"SageMaker Studio Domain ID: {domain_id}")
    return domain_id


def get_sagemaker_studio_apps(domain_id: str) -> List[Dict]:
    """List all the SageMaker Studio apps for the domain and user profile.

    Args:
        domain_id (str): the SageMaker domain ID

    Returns:
        List[Dict]: the list of SageMaker Studio apps
    """
    logger.info(f"Listing all the SageMaker Studio apps for the domain {SAGEMAKER_DOMAIN_NAME}")
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
        logger.info(f"No SageMaker Studio apps found for the domain {SAGEMAKER_DOMAIN_NAME}")
        return
    logger.info(f"Deleting all the user created SageMaker Studio apps for the domain {SAGEMAKER_DOMAIN_NAME}")
    for app in apps:
        app_name = app.get("AppName")
        logger.info(f"Deleting the user created SageMaker Studio app {app_name}")
        # The app created by the SageMaker stack will be automatically destroyed
        # Here we are deleting the apps created by the user
        if app_name != SAGEMAKER_APP_NAME:
            sagemaker.delete_app(
                DomainId=domain_id,
                UserProfileName=SAGEMAKER_USER_PROFILE,
                AppName=app_name,
                AppType=app.get("AppType")
            )
