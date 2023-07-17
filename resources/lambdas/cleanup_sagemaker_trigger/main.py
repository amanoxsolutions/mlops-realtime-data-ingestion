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

def lambda_handler(event, context):
    logger.info({"event": event})
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        physical_id = event.get("ResourceProperties").get("PhysicalResourceId")
        step_function_arn = event.get("ResourceProperties").get("StepFunctionArn")
        domain_id = event.get("ResourceProperties").get("DomainId")
        user_profile = event.get("ResourceProperties").get("StudioUserProfile")
        default_user_app_name = event.get("ResourceProperties").get("StudioAppName")
        cf_callback_url = event.get("ResourceProperties").get("CfCallbackUrl")
        if request == "delete":
            # Launch the deletion of the SageMaker Studio apps
            apps = delete_sagemaker_studio_apps(domain_id, user_profile, default_user_app_name)
            # Launch the Step Function to wait for the deletion of the SageMaker Studio apps
            stepfunctions.start_execution(
                stateMachineArn=step_function_arn,
                input=json.dumps({
                    "sagemaker_domain_id": domain_id,
                    "sagemaker_user_profile": user_profile,
                    "sagemaker_user_apps": apps,
                    "status": "DELETING",
                    "cf_callback_url": cf_callback_url})
            )
        else:
            # Id we are not deleting the stack, we don't need to do anything,
            # so we just send a SUCCESS response to CloudFormation
            logger.info("No action required")
            stepfunctions.start_execution(
                stateMachineArn=step_function_arn,
                input=json.dumps({
                    "sagemaker_domain_id": domain_id,
                    "sagemaker_user_profile": user_profile,
                    "sagemaker_user_apps": "",
                    "status": "SUCCESS",
                    "cf_callback_url": cf_callback_url})
            )
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physicalResourceId=physical_id)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physicalResourceId=physical_id)


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


def delete_sagemaker_studio_apps(domain_id: str, user_profile: str, default_user_app_name: str) -> List[Dict]:
    """List and delete all the SageMaker Studio apps for the domain and user profile
    escept the one created by the CDK SageMaker stack.

    Args:
        domain_id (str): the SageMaker domain ID
        user_profile (str): the SageMaker Studio user profile name
        default_user_app_name (str): the default SageMaker Studio app name creted by the stack

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
        # The app created by the SageMaker stack will be automatically destroyed
        # Here we are deleting the apps created by the user if they are not already deleted or being deleted
        if app_name != default_user_app_name and status != "Deleting" and status != "Deleted":
            logger.info(f"Deleting the user created SageMaker Studio app {app_name}")
            sagemaker.delete_app(
                DomainId=domain_id,
                UserProfileName=user_profile,
                AppName=app_name,
                AppType=type
            )
    return apps_list
    