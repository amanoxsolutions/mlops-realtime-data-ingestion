import os
import boto3
import logging
import lib.cfnresponse as cfnresponse

logger = logging.getLogger()
logger.setLevel(logging.INFO)
ecr = boto3.client("ecr")

def lambda_handler(event, context):
    logger.info({"event": event})
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        physical_id = event.get("ResourceProperties").get("PhysicalResourceId")
        ecr_repository_name = event.get("ResourceProperties").get("EcrRepositoryName")
        if request == "delete":
            next_token = delete_ecr_images(ecr_repository_name)
            while next_token:
                next_token = delete_ecr_images(ecr_repository_name, next_token)
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physicalResourceId=physical_id)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physicalResourceId=physical_id)

def delete_ecr_images(ecr_repository_name: str, next_token: str = None) -> str:
    """This function list images in ECR repository and delete them

    Args:
        ecr_repository_name (str): the ECR repository name
        next_token (str, optional): the next token to use for pagination. Defaults to None.

    Returns:
        str: the next token to use for pagination
    """
    if not next_token:
        ecr_response = ecr.list_images(repositoryName=ecr_repository_name)
    else:
        ecr_response = ecr.list_images(
            repositoryName=ecr_repository_name,
            NextToken=next_token
        )
    images_list = ecr_response.get("imageIds", [])
    next_token = ecr_response.get("NextToken")

    if images_list:
        delete_response = ecr.batch_delete_image(
            repositoryName=ecr_repository_name,
            imageIds=images_list
        )
        logger.info({"ECR images deleted": delete_response.get("imageIds", [])})
        logger.info({"ECR images deletion failed": delete_response.get("failures", [])})
    return next_token
