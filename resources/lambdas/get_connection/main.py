import boto3
from aws_lambda_powertools import Logger
from crhelper import CfnResource
from typing import Tuple

helper = CfnResource()
logger = Logger()
csc = boto3.client("codestar-connections")
ssm_client = boto3.client("ssm")

@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)

@helper.create
@helper.update
def get_connection_arn(event, _):
    connection_name = event.get("ResourceProperties").get("ConnectionName")
    connection_arn, next_token = search_for_connection(connection_name)
    while (connection_arn is None) and next_token:
        connection_arn, next_token = search_for_connection(connection_name, next_token)
    if connection_arn:
        helper.Data.update({"ConnectionArn": connection_arn})
        logger.info(f"CodeStar Connection ARN for '{connection_name}' found")
        ssm_client.put_parameter(
            Name="/rdi-mlops/stack-parameters/connection-arn",
            Value=connection_arn,
            Type='String',
            Overwrite=True
        )
    else:
        error_reason = f"CodeStar Connection ARN for '{connection_name}' not found"
        logger.error(error_reason)
        return {
            'Status': 'FAILED',
            'Reason': error_reason,
            'LogicalResourceId': event.LogicalResourceId,
            'RequestId': event.RequestId,
            'StackId': event.StackId
        }

@helper.delete
def do_nothing(_, __):
    logger.info("Nothing to do")

def search_for_connection(connection_name: str, next_token: str = None) -> Tuple[str, str]:
    """This function list CodeStar connections and search for the connection ARN

    Args:
        connection_name (str): the CodeStar connection name
        next_token (str, optional): the next token to use for pagination. Defaults to None.

    Returns:
        Tuple[str, str]: the CodeStar connection ARN and the next token to use for pagination
    """
    if not next_token:
        csc_response = csc.list_connections(
            ProviderTypeFilter="GitHub"
        )
    else:
        csc_response = csc.list_connections(
            ProviderTypeFilter="GitHub",
            NextToken = next_token
        )
    connections_list = csc_response.get("Connections", [])
    next_token = csc_response.get("NextToken")
    logger.info({"connection_list": connections_list})

    connection_arn = None
    for connection in connections_list:
        if connection.get("ConnectionName") == connection_name:
            connection_arn = connection.get("ConnectionArn")
    return connection_arn, next_token