import os
import boto3
import logging
import lib.cfnresponse as cfnresponse

logger = logging.getLogger()
logger.setLevel(logging.INFO)
ecr = boto3.client("ecr")

ECR_REPOSITORY_NAME = os.environ["ECR_REPOSITORY_NAME"]
PHYSICAL_ID = "CustomResourceToCleanupEcrImages"

def lambda_handler(event, context):
    response_data = {"deletedImages": []}
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        if request == "delete":
            next_token = delete_ecr_images()
            while next_token:
                next_token = delete_ecr_images(next_token)
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physicalResourceId=PHYSICAL_ID)
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=PHYSICAL_ID)

def delete_ecr_images(next_token: str = None) -> str:
    """This function list images in ECR repository and delete them
    """
    if not next_token:
        ecr_response = ecr.list_images(repositoryName=ECR_REPOSITORY_NAME)
    else:
        ecr_response = ecr.list_images(
            repositoryName=ECR_REPOSITORY_NAME,
            NextToken=next_token
        )
    images_list = ecr_response.get("imageIds", [])
    next_token = ecr_response.get("NextToken")

    if images_list:
        delete_response = ecr.batch_delete_image(
            repositoryName=ECR_REPOSITORY_NAME,
            imageIds=images_list
        )
        logger.info({"ECR images deleted": delete_response.get("imageIds", [])})
        logger.info({"ECR images deletion failed": delete_response.get("failures", [])})
    return next_token
