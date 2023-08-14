import time
import boto3
import logging
import lib.cfnresponse as cfnresponse

from botocore.exceptions import ClientError
from typing import Dict

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sagemaker = boto3.client("sagemaker")

def lambda_handler(event, context):
    logger.info({"event": event})
    domain_id = event.get("PhysicalResourceId")
    domain_properties = event.get("ResourceProperties")
    request_type = event.get("RequestType").lower()
    try:
        if request_type == "create":
            domain_id = handle_create(domain_properties)
        elif request_type == "update":
            handle_update(domain_id, domain_properties)
        elif request_type == "delete":
            handle_delete(domain_id, domain_properties)
    except ClientError as exception:
        logger.exception(exception)
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physicalResourceId=domain_id)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {"DomainId": domain_id}, 
                         physicalResourceId=domain_id)

def handle_create(domain_properties: Dict) -> str:
    """Creates the SageMaker Studio domain and returns the domain ID.

    Args:
        domain_properties (Dict): The configuration settings for the SageMaker Domain

    Returns:
        str: the domain ID
    """
    logger.info("Creating studio domain")
    vpc_id = domain_properties["VpcId"]
    subnet_ids = domain_properties["SubnetIds"]
    default_user_settings = domain_properties["DefaultUserSettings"]
    domain_name = domain_properties["DomainName"]
    response = sagemaker.create_domain(
        DomainName=domain_name,
        AuthMode="IAM",
        DefaultUserSettings=default_user_settings,
        SubnetIds=subnet_ids,
        VpcId=vpc_id
    )
    domain_id = response["DomainArn"].split("/")[-1]
    created = False
    while not created:
        response = sagemaker.describe_domain(DomainId=domain_id)
        domain_status = response.get("Status")
        time.sleep(5)
        logger.info(f"SageMaker domain status: {domain_status}")
        if domain_status == "InService":
            created = True
    logger.info(f"SageMaker domain created successfully: {domain_id}")
    return domain_id


def handle_delete(domain_id: str, domain_properties: Dict):
    """Delete the SageMaker Domain

    Args:
        domain_id (str): SageMaker Domain Id
        domain_properties (Dict): The configuration settings for the SageMaker Domain

    Returns:
        None
    """
    logger.info("Received delete event")
    removal_policy = domain_properties.get("RemovalPolicy", "destroy").lower()
    if removal_policy == "destroy":
        logger.info(f"Deleting domain {domain_id} and its EFS file system")
        response = sagemaker.delete_domain(
            DomainId=domain_id,
            RetentionPolicy={
                "HomeEfsFileSystem": "Delete"
            }
        )
        deleted = False
        while not deleted:
            try:
                sagemaker.describe_domain(DomainId=domain_id)
            except ClientError as error:
                if error.response["Error"]["Code"] == "ResourceNotFound":
                    logger.info(f"Deleted domain {domain_id} successfully")
                    deleted = True
                    return
            time.sleep(5)
    else:
        logger.info(f"Skipping deletion of domain {domain_id} because removal policy is set to {removal_policy}")


def handle_update(domain_id: str, domain_properties: Dict):
    """Update the SageMaker Domain
    
    Args:
        domain_id (str): SageMaker Domain Id
        domain_properties (Dict): The configuration settings for the SageMaker Domain
        
    Returns:
        None
    """
    logger.info("Received Update event")
    default_user_settings = domain_properties["DefaultUserSettings"]
    response = sagemaker.update_domain(
        DomainId=domain_id,
        DefaultUserSettings=default_user_settings
    )
    updated = False
    while not updated:
        response = sagemaker.describe_domain(DomainId=domain_id)
        domain_status = response.get("Status")
        logger.info(f"SageMaker domain status: {domain_status}")
        if domain_status == "InService":
            updated = True
        time.sleep(5)
