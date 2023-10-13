import time
import boto3
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from botocore.exceptions import ClientError
from typing import Dict

helper = CfnResource()
logger = Logger()
sagemaker = boto3.client("sagemaker")


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)

@helper.create
def create(event, _):
    domain_properties = event.get("ResourceProperties")
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
    helper.Data.update({"DomainId": domain_id})
    logger.info(f"SageMaker domain created successfully: {domain_id}")
    return domain_id

@helper.delete
def delete(event, _):
    domain_id = event.get("PhysicalResourceId")
    domain_properties = event.get("ResourceProperties")
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

@helper.update
def update(event, _):
    domain_id = event.get("PhysicalResourceId")
    domain_properties = event.get("ResourceProperties")
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
    helper.Data.update({"DomainId": domain_id})
