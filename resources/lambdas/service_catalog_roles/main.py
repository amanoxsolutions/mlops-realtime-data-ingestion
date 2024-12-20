import json
import boto3
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from typing import List

helper = CfnResource()
logger = Logger()
iam = boto3.client("iam")

SC_PROD_LAUNCH_ROLE = "AmazonSageMakerServiceCatalogProductsLaunchRole"
SC_PROD_USE_ROLE = "AmazonSageMakerServiceCatalogProductsUseRole"
SC_PROD_EXECUTION_ROLE = "AmazonSageMakerServiceCatalogProductsExecutionRole"
SC_PROD_CODEPIPELINE_ROLE = "AmazonSageMakerServiceCatalogProductsCodePipelineRole"
SC_PROD_CODEBUILD_ROLE = "AmazonSageMakerServiceCatalogProductsCodeBuildRole"
SC_PROD_CLOUDFORMATION_ROLE = "AmazonSageMakerServiceCatalogProductsCloudformationRole"
SC_PROD_LAMBDA_ROLE = "AmazonSageMakerServiceCatalogProductsLambdaRole"
SC_PROD_EVENTS_ROLE = "AmazonSageMakerServiceCatalogProductsEventsRole"


@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)


@helper.create
def create(event, _):
    domain_properties = event.get("ResourceProperties")
    account = domain_properties["Account"]
    stack_prefix = domain_properties["StackPrefix"]
    # Create the AmazonSageMakerServiceCatalogProductsLaunchRole and AmazonSageMakerServiceCatalogProductsUseRole roles
    add_roles(SC_PROD_LAUNCH_ROLE, stack_prefix, account)
    add_roles(SC_PROD_USE_ROLE, stack_prefix, account)
    add_roles(SC_PROD_EXECUTION_ROLE, stack_prefix, account)
    add_roles(SC_PROD_CODEPIPELINE_ROLE, stack_prefix, account)
    add_roles(SC_PROD_CODEBUILD_ROLE, stack_prefix, account)
    add_roles(SC_PROD_CLOUDFORMATION_ROLE, stack_prefix, account)
    add_roles(SC_PROD_LAMBDA_ROLE, stack_prefix, account)
    add_roles(SC_PROD_EVENTS_ROLE, stack_prefix, account)
    helper.Data.update(
        {
            "ServiceCatalogProductsLaunchRoleName": SC_PROD_LAUNCH_ROLE,
            "ServiceCatalogProductsUseRoleName": SC_PROD_USE_ROLE,
            "ServiceCatalogProductsExecutionRoleName": SC_PROD_EXECUTION_ROLE,
            "ServiceCatalogProductsCodePipelineRoleName": SC_PROD_CODEPIPELINE_ROLE,
            "ServiceCatalogProductsCodeBuildRoleName": SC_PROD_CODEBUILD_ROLE,
            "ServiceCatalogProductsCloudFormationRoleName": SC_PROD_CLOUDFORMATION_ROLE,
            "ServiceCatalogProductsLambdaRoleName": SC_PROD_LAMBDA_ROLE,
            "ServiceCatalogProductsEventsRoleName": SC_PROD_EVENTS_ROLE,
        }
    )


def add_roles(role_name: str, stack_prefix: str, account: str):
    """This function creates the AmazonSageMakerServiceCatalogProductsLaunchRole and
    AmazonSageMakerServiceCatalogProductsUseRole roles.

    Args:
        role_name (str): The name of the role to create
        stack_prefix (str): The prefix to use for the policy name
        account (str): The account number
    """
    try:
        iam.get_role(RoleName=role_name)
        logger.info(f"Role {role_name} already exists")
    except iam.exceptions.NoSuchEntityException:
        logger.info(f"Creating role {role_name}")
        if role_name == SC_PROD_EVENTS_ROLE:
            assume_role_policy = generate_assume_role_policy(service="events")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/service-role/AmazonSageMakerServiceCatalogProductsEventsServiceRolePolicy",
                RoleName=role_name,
            )
        if role_name == SC_PROD_LAMBDA_ROLE:
            assume_role_policy = generate_assume_role_policy(service="lambda")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/service-role/AmazonSageMakerServiceCatalogProductsLambdaServiceRolePolicy",
                RoleName=role_name,
            )
        if role_name == SC_PROD_CLOUDFORMATION_ROLE:
            assume_role_policy = generate_assume_role_policy(service="cloudformation")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/service-role/AmazonSageMakerServiceCatalogProductsCloudformationServiceRolePolicy",
                RoleName=role_name,
            )
        if role_name == SC_PROD_CODEBUILD_ROLE:
            assume_role_policy = generate_assume_role_policy(service="codebuild")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/AmazonSageMakerServiceCatalogProductsCodeBuildServiceRolePolicy",
                RoleName=role_name,
            )
        if role_name == SC_PROD_CODEPIPELINE_ROLE:
            assume_role_policy = generate_assume_role_policy(service="codepipeline")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/service-role/AmazonSageMakerServiceCatalogProductsCodePipelineServiceRolePolicy",
                RoleName=role_name,
            )
        if role_name == SC_PROD_LAUNCH_ROLE:
            assume_role_policy = generate_assume_role_policy(service="servicecatalog")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/AmazonSageMakerAdmin-ServiceCatalogProductsServiceRolePolicy",
                RoleName=role_name,
            )
        if role_name == SC_PROD_EXECUTION_ROLE:
            assume_role_policy = generate_assume_role_policy(service="sagemaker")
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            iam.attach_role_policy(
                PolicyArn="arn:aws:iam::aws:policy/AmazonSageMakerFullAccess",
                RoleName=role_name,
            )
        if role_name == SC_PROD_USE_ROLE:
            assume_role_policy = generate_assume_role_policy(
                services=[
                    "apigateway.amazonaws.com",
                    "cloudformation.amazonaws.com",
                    "codebuild.amazonaws.com",
                    "codepipeline.amazonaws.com",
                    "events.amazonaws.com",
                    "firehose.amazonaws.com",
                    "glue.amazonaws.com",
                    "lambda.amazonaws.com",
                    "sagemaker.amazonaws.com",
                    "states.amazonaws.com",
                ]
            )
            # Read the JSON policy from the file
            with open("./servicecatalog_products_userole.json", "r") as file:
                product_use_role_policy = file.read()
            iam.create_role(
                Path="/service-role/",
                RoleName=role_name,
                AssumeRolePolicyDocument=assume_role_policy,
            )
            policy_name = f"{stack_prefix}-product-use-role-policy"
            iam.create_policy(
                PolicyName=policy_name, PolicyDocument=product_use_role_policy
            )
            iam.attach_role_policy(
                PolicyArn=f"arn:aws:iam::{account}:policy/{policy_name}",
                RoleName=role_name,
            )
    except Exception as e:
        raise e


def generate_assume_role_policy(service: str = None, services: List[str] = []) -> str:
    """This function creates the assume role policy for the Service Catalog roles.

    Args:
        service (str): The service for which the policy is created
        services (List[str]): The list of services for which the policy is created

    Returns:
        str: The assume role policy
    """
    assume_role_policy = ""
    if service:
        assume_role_policy = json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"Service": f"{service}.amazonaws.com"},
                        "Action": "sts:AssumeRole",
                    }
                ],
            }
        )
    elif services:
        assume_role_policy = json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"Service": services},
                        "Action": "sts:AssumeRole",
                    }
                ],
            }
        )
    return assume_role_policy


@helper.update
@helper.delete
def do_nothing(_, __):
    logger.info("Nothing to do")
