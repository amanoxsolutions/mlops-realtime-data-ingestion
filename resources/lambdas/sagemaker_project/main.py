import time
import boto3
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from botocore.exceptions import ClientError
from typing import Dict

helper = CfnResource()
logger = Logger()
sagemaker = boto3.client("sagemaker")
catalog = boto3.client("servicecatalog")


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)

@helper.create
def create(event, _):
    project_properties = event.get("ResourceProperties")
    project_name = project_properties["ProjectName"]
    # List the portfolios in the AWS Service Catalog
    # There should be an imported portfolio called "Amazon SageMaker Solutions and ML Ops products"
    # This portfolio contains the SageMaker project template we want to use
    response = catalog.list_accepted_portfolio_shares(
        PortfolioShareType = "IMPORTED"
    )
    logger.info("Imported Portfolios:", response)
    portfolio_id = None
    for portfolio in response["PortfolioDetails"]:
        if portfolio["DisplayName"] == "Amazon SageMaker Solutions and ML Ops products":
            portfolio_id = portfolio["Id"]
            break
    if portfolio_id is None:
        logger.error("Could not find portfolio 'Amazon SageMaker Solutions and ML Ops products'")
        raise Exception("Could not find portfolio 'Amazon SageMaker Solutions and ML Ops products'")
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
    logger.info("Found latest product artifact", product_artifacts[0])
    # Create the SageMaker Project for the SageMaker domain
    response = sagemaker.create_project(
        ProjectName=project_name,
        ProjectDescription="MLOps project for the Realtime Data Ingestion and Analytics solution",
        ServiceCatalogProvisioningDetails={
            "ProductId": product_id,
            "ProvisioningArtifactId": latest_product_artifact_id
        }
    )
    project_id = response["ProjectId"]
    logger.info(f"Created SageMaker project with ID: {project_id}")
    # Wait for the SageMaker project to be created
    created = False
    while not created:
        response = sagemaker.describe_project(ProjectName=project_name)
        project_status = response.get("ProjectStatus")
        time.sleep(5)
        logger.info(f"SageMaker project status: {project_status}")
        if project_status == "CreateCompleted":
            created = True
    logger.info(f"SageMaker project created successfully: {project_id}")
    helper.Data.update({"ProjectId": project_id})
    return project_id

@helper.delete
def delete(event, _):
    project_properties = event.get("ResourceProperties")
    project_name = project_properties["ProjectName"]
    # Delete the SageMaker project
    response = sagemaker.delete_project(
        ProjectName=project_name
    )
    # Wait for the SageMaker project to be deleted
    deleted = False
    while not deleted:
        try:
            sagemaker.describe_project(ProjectName=project_name)
        except ClientError as error:
            if error.response["Error"]["Code"] == "ResourceNotFound":
                logger.info(f"Deleted SageMaker project {project_name} successfully")
                deleted = True
                return
        time.sleep(5)

@helper.update
def do_nothing(_, __):
    logger.info("Nothing to do")
