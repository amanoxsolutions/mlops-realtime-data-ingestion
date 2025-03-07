import time
import boto3
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from botocore.exceptions import ClientError

helper = CfnResource()
logger = Logger()
sagemaker = boto3.client("sagemaker")
catalog = boto3.client("servicecatalog")


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)


@helper.create
def create(event, _):
    domain_properties = event.get("ResourceProperties")
    vpc_id = domain_properties["VpcId"]
    subnet_ids = domain_properties["SubnetIds"]
    domain_execution_role_arn = domain_properties["ExecutionRole"]
    domain_name = domain_properties["DomainName"]
    default_setting = get_default_domain_settings(domain_execution_role_arn)
    response = sagemaker.create_domain(
        DomainName=domain_name,
        AuthMode="IAM",
        DefaultSpaceSettings=default_setting["DefaultSpaceSettings"],
        DefaultUserSettings=default_setting["DefaultUserSettings"],
        AppNetworkAccessType="PublicInternetOnly",
        SubnetIds=subnet_ids,
        VpcId=vpc_id,
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
    # Enable the use of Service Catalog in SageMaker. This is mandatory to be able to use SageMaker projects
    enable_sagemaker_servicecatalog()
    portfolio_id = get_portfolio_id()
    # Enable the use of SageMaker projects in the SageMaker domain.
    # This can only be done if no app is running so let's do that before we create any user in the domain.
    # To enable SageMaker projects in the domain we must associate the domain role
    # with the SageMaker Service Catalog portfolio. We also need to associate the domain user role for
    # users to be able to use SageMaker projects.
    response = catalog.associate_principal_with_portfolio(
        PortfolioId=portfolio_id,
        PrincipalARN=domain_execution_role_arn,
        PrincipalType="IAM",
    )
    logger.info(f"Associated SageMaker domain role {domain_execution_role_arn}")
    helper.Data.update({"DomainId": domain_id, "PortfolioId": portfolio_id})
    return domain_id


def enable_sagemaker_servicecatalog():
    """This function enables the use of the Service Catalog in SageMaker and waits for it to be enabled."""
    response = sagemaker.enable_sagemaker_servicecatalog_portfolio()
    logger.info("Enabling the SageMaker Service Catalog portfolio")
    # Wait for the SageMaker Service Catalog portfolio to be enabled
    enabled = False
    while not enabled:
        response = sagemaker.get_sagemaker_servicecatalog_portfolio_status()
        status = response["Status"]
        logger.info(f"SageMaker Service Catalog portfolio status: {status}")
        if status == "Enabled":
            enabled = True
        time.sleep(5)


def get_portfolio_id():
    """This function returns the ID of the Service Catalog 'Amazon SageMaker Solutions and ML Ops products' portfolio.

    Returns:
        str: The ID of the SageMaker Service Catalog portfolio
    """
    # List the portfolios in the AWS Service Catalog
    # There should be an imported portfolio called "Amazon SageMaker Solutions and ML Ops products"
    # This portfolio contains the SageMaker project template we want to use
    response = catalog.list_accepted_portfolio_shares(PortfolioShareType="IMPORTED")
    logger.info(f"Imported Portfolios: {response}")
    portfolio_id = None
    for portfolio in response["PortfolioDetails"]:
        if portfolio["DisplayName"] == "Amazon SageMaker Solutions and ML Ops products":
            portfolio_id = portfolio["Id"]
            break
    if portfolio_id is None:
        logger.error(
            "Could not find portfolio 'Amazon SageMaker Solutions and ML Ops products'"
        )
        raise Exception(
            "Could not find portfolio 'Amazon SageMaker Solutions and ML Ops products'"
        )
    return portfolio_id


@helper.delete
def delete(event, _):
    domain_id = event.get("PhysicalResourceId")
    domain_properties = event.get("ResourceProperties")
    removal_policy = domain_properties.get("RemovalPolicy", "destroy").lower()
    if removal_policy == "destroy":
        # Check if the SageMaker domain exists.
        # If it does not, just return as there is nothing to delete
        try:
            sagemaker.describe_domain(DomainId=domain_id)
        except ClientError as error:
            logger.info(f"Error code: {error.response['Error']['Code']}")
            logger.info(f"SageMaker domain {domain_id} does not exist")
            return
        # Delete the SageMaker domain
        logger.info(f"Deleting domain {domain_id} and its EFS file system")
        sagemaker.delete_domain(
            DomainId=domain_id, RetentionPolicy={"HomeEfsFileSystem": "Delete"}
        )
        # Wait for the SageMaker domain to be deleted
        deleted = False
        while not deleted:
            try:
                sagemaker.describe_domain(DomainId=domain_id)
            except ClientError as error:
                logger.info(f"Error code: {error.response['Error']['Code']}")
                logger.info(f"Deleted domain {domain_id} successfully deleted")
                deleted = True
                return
            time.sleep(5)
    else:
        logger.info(
            f"Skipping deletion of domain {domain_id} because removal policy is set to {removal_policy}"
        )


@helper.update
def update(event, _):
    domain_id = event.get("PhysicalResourceId")
    domain_properties = event.get("ResourceProperties")
    domain_execution_role_arn = domain_properties["ExecutionRole"]
    default_setting = get_default_domain_settings(domain_execution_role_arn)
    response = sagemaker.update_domain(
        DomainId=domain_id, 
        DefaultSpaceSettings=default_setting["DefaultSpaceSettings"],
        DefaultUserSettings=default_setting["DefaultUserSettings"],
    )
    updated = False
    while not updated:
        response = sagemaker.describe_domain(DomainId=domain_id)
        domain_status = response.get("Status")
        logger.info(f"SageMaker domain status: {domain_status}")
        if domain_status == "InService":
            updated = True
        time.sleep(5)
    portfolio_id = get_portfolio_id()
    helper.Data.update({"DomainId": domain_id, "PortfolioId": portfolio_id})


def get_default_domain_settings(domain_execution_role_arn: str):
    """This function returns the default space and user settings for the SageMaker domain.

    Args:
        domain_execution_role_arn: The ARN of the default execution role
    Returns:
        dict: The default space and user settings for the SageMaker domain
    """
    default_settings = {
        "DefaultSpaceSettings": {
            "ExecutionRole": domain_execution_role_arn,
            "SpaceStorageSettings": {
                "DefaultEbsStorageSettings": {
                    "DefaultEbsVolumeSizeInGb": 5,
                    "MaximumEbsVolumeSizeInGb": 100
                }
            },
            "JupyterLabAppSettings": {
                "AppLifecycleManagement": {
                    "IdleSettings": {
                        "LifecycleManagement": "ENABLED",
                        "IdleTimeoutInMinutes": 120,
                        "MinIdleTimeoutInMinutes": 60,
                        "MaxIdleTimeoutInMinutes": 240
                    }
                }
            }
        },
        "DefaultUserSettings": {
            "ExecutionRole": domain_execution_role_arn,
            "SharingSettings": {
                "NotebookOutputOption": "Disabled",
            },
            "SpaceStorageSettings": {
                "DefaultEbsStorageSettings": {
                    "DefaultEbsVolumeSizeInGb": 5,
                    "MaximumEbsVolumeSizeInGb": 100
                }
            },
            "CanvasAppSettings": {
                "TimeSeriesForecastingSettings": {
                    "Status": "DISABLED"
                },
                "ModelRegisterSettings": {
                    "Status": "DISABLED"
                },
                "DirectDeploySettings": {
                    "Status": "DISABLED"
                },
                "KendraSettings": {
                    "Status": "DISABLED"
                },
                "EmrServerlessSettings": {
                    "Status": "DISABLED"
                }
            },
            "StudioWebPortal": "ENABLED",
            "AutoMountHomeEFS": "Disabled",
            "StudioWebPortalSettings": {
                "HiddenAppTypes": [
                    "JupyterServer",
                    "RStudioServerPro",
                    "Canvas"
                ],
                "HiddenMlTools": []
            },
            "JupyterLabAppSettings": {
                "AppLifecycleManagement": {
                    "IdleSettings": {
                        "LifecycleManagement": "ENABLED",
                        "IdleTimeoutInMinutes": 120,
                        "MinIdleTimeoutInMinutes": 60,
                        "MaxIdleTimeoutInMinutes": 240
                    }
                }
            },
            "CodeEditorAppSettings": {
                "AppLifecycleManagement": {
                    "IdleSettings": {
                        "LifecycleManagement": "ENABLED",
                        "IdleTimeoutInMinutes": 120,
                        "MinIdleTimeoutInMinutes": 60,
                        "MaxIdleTimeoutInMinutes": 240
                    }
                }
            }
        }
    }
    return default_settings
