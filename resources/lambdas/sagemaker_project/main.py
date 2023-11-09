import time
import boto3
import random
import string
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from botocore.exceptions import ClientError
from typing import Dict

helper = CfnResource()
logger = Logger()
catalog = boto3.client("servicecatalog")
sts_connection = boto3.client('sts')


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)

@helper.create
def create(event, _):
    project_properties = event.get("ResourceProperties")
    resource_prefix = project_properties.get("ResourcePrefix")
    # Add a 8 characters random suffix string to the project name to make it unique
    # and make sure the project name is not longer than 32 characters
    project_name = resource_prefix + "-proj-" + "".join(random.choices(string.digits + string.ascii_lowercase, k=8))
    project_name = project_name[:32]
    portfolio_id = project_properties.get("PortfolioId")
    domain_execution_role_arn = project_properties.get("DomainExecutionRoleArn")
    # Search for the SageMaker project product in the portfolio
    # We want to use the "MLOps template for model building, training, deployment and monitoring" product
    response = catalog.search_products_as_admin(
        PortfolioId=portfolio_id,
        Filters={
            "FullTextSearch": [
                "MLOps template for model building, training, deployment and monitoring"
            ]
        }
    )
    product_id = None
    for product in response["ProductViewDetails"]:
        if product["ProductViewSummary"]["Name"] == "MLOps template for model building, training, deployment and monitoring":
            product_id = product["ProductViewSummary"]["ProductId"]
            break
    if product_id is None:
        logger.error("Could not find product 'MLOps template for model building, training, deployment and monitoring'")
        raise Exception("Could not find product 'MLOps template for model building, training, deployment and monitoring'")
    logger.info(f"Found product 'MLOps template for model building, training, deployment and monitoring' with ID: {product_id}")
    # Get the latest version of the product
    response = catalog.describe_product_as_admin(
        Id=product_id
    )
    product_artifacts = response["ProvisioningArtifactSummaries"]
    product_artifacts.sort(key=lambda x: x["CreatedTime"], reverse=True)
    latest_product_artifact_id = product_artifacts[0]["Id"]
    logger.info(f"Found latest product artifact: {product_artifacts[0]}")
    # Create the SageMaker Project for the SageMaker domain
    sagemaker = get_sagemaker_client_with_domain_execution_role(domain_execution_role_arn)
    response = sagemaker.create_project(
        ProjectName=project_name,
        ProjectDescription="MLOps project for the Realtime Data Ingestion and Analytics solution",
        ServiceCatalogProvisioningDetails={
            "ProductId": product_id,
            "ProvisioningArtifactId": latest_product_artifact_id
        }
    )
    project_id = response["ProjectId"]
    logger.info(f"Initiated the creation of the SageMaker project with ID: {project_id}")
    # We do not wait for the SageMaker project to be created because 
    # it is created by another CloudFormation Stack and it takes too long
    helper.Data.update({"ProjectId": project_id, "ProjectName": project_name})
    return project_id

@helper.delete
def delete(event, _):
    project_properties = event.get("ResourceProperties")
    project_name = project_properties.get("ProjectName")
    domain_execution_role_arn = project_properties.get("DomainExecutionRoleArn")
    removal_policy = project_properties.get("RemovalPolicy", "destroy").lower()
    if removal_policy == "destroy":
        sagemaker = get_sagemaker_client_with_domain_execution_role(domain_execution_role_arn)
        # Check if the SageMaker project exists.
        # If it does not, just return as ther is nothing to delete
        try:
            response = sagemaker.describe_project(ProjectName=project_name)
        except ClientError as error:
            if error.response["Error"]["Code"] == "ResourceNotFound":
                logger.info(f"SageMaker project {project_name} does not exist")
                return
        # Delete the SageMaker project
        response = sagemaker.delete_project(
            ProjectName=project_name
        )
        logger.info(f"Initiated the SageMaker project deletion: {response}")
        # We do not wait for the SageMaker project to be deleted because 
        # it is deleted by another CloudFormation Stack and it takes too long
    else:
        logger.info(f"Skipping deletion of SageMaker project {project_name} because removal policy is set to {removal_policy}")

@helper.update
def do_nothing(_, __):
    logger.info("Nothing to do")

def get_sagemaker_client_with_domain_execution_role(role_arn: str):
    """This function assumes the domain execution role and use it to initialize the SageMaker client

    Args:
        role_arn (str): The domain execution role ARN

    Returns:
        SageMaker client
    """
    # Call the assume_role method of the STSConnection object and pass the role
    # ARN and a role session name.
    logger.info({f"Assuming the {role_arn} IAM Role to create the SageMaker Project"})
    sts_response = sts_connection.assume_role(
        RoleArn=role_arn,
        RoleSessionName="SreateSagemakerProject"+"".join(random.choices(string.digits, k=10)),
    )
    logger.info({"sts AssumeRole response": sts_response})
    # From the response that contains the assumed role, get the temporary 
    # credentials that can be used to make subsequent API calls
    credentials = sts_response["Credentials"]
    access_key = credentials["AccessKeyId"]
    secret_key = credentials["SecretAccessKey"]
    session_token = credentials["SessionToken"]
    # Initialize the SageMaker client using the assumed role credentials
    sagemaker_client = boto3.client(
        "sagemaker",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        aws_session_token=session_token,
    )
    return sagemaker_client
