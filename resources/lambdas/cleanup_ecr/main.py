import boto3
from aws_lambda_powertools import Logger
from crhelper import CfnResource

helper = CfnResource()
logger = Logger()
ecr = boto3.client("ecr")


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)


@helper.create
@helper.update
def do_nothing(_, __):
    logger.info("Nothing to do")


@helper.delete
def delete(event, _):
    ecr_repository_name = event.get("ResourceProperties").get("EcrRepositoryName")
    next_token = delete_ecr_images(ecr_repository_name)
    while next_token:
        next_token = delete_ecr_images(ecr_repository_name, next_token)


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
            repositoryName=ecr_repository_name, NextToken=next_token
        )
    images_list = ecr_response.get("imageIds", [])
    next_token = ecr_response.get("NextToken")

    if images_list:
        delete_response = ecr.batch_delete_image(
            repositoryName=ecr_repository_name, imageIds=images_list
        )
        logger.info({"ECR images deleted": delete_response.get("imageIds", [])})
        logger.info({"ECR images deletion failed": delete_response.get("failures", [])})
    return next_token
