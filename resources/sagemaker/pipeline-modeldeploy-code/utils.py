import botocore
from botocore.exceptions import ClientError
import logging

logger = logging.getLogger(__name__)

def get_latest_approved_package(
        model_package_group_name: str,
        sm_client: botocore.client
    ):
    """Gets the latest approved model package for a model package group.

    Args:
        model_package_group_name: The model package group name.
        sm_client (Boto3 SageMaker client): Amazon SageMaker boto3 client

    Returns:
        The SageMaker Model Package ARN.
    """
    try:
        # First get the latest approved model package for the model package group
        # NOTE: This only works if we approve the latest model. If we suddenly approve an older model this
        # would use the information of the "latest created and approved" model but this is enough for the demo
        response = sm_client.list_model_packages(
            ModelPackageGroupName=model_package_group_name,
            ModelApprovalStatus="Approved",
            SortBy="CreationTime",
            SortOrder="Descending",
            MaxResults=1,
        )
        latest_approved_package = response["ModelPackageSummaryList"]

        # Return error if no packages found
        if len(latest_approved_package) == 0:
            error_message = f"No approved ModelPackage found for ModelPackageGroup: {model_package_group_name}"
            logger.error(error_message)
            raise Exception(error_message)

        # Return the pmodel package arn
        model_package_arn = latest_approved_package[0]["ModelPackageArn"]
        logger.info(
            f"Identified the latest approved model package: {model_package_arn}"
        )
        return model_package_arn
    except ClientError as e:
        error_message = e.response["Error"]["Message"]
        logger.error(error_message)
        raise Exception(error_message)