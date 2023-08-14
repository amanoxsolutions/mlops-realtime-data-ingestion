import os
import boto3
import logging
import lib.cfnresponse as cfnresponse
from typing import Tuple

logger = logging.getLogger()
logger.setLevel(logging.INFO)
csc = boto3.client("codestar-connections")


def lambda_handler(event, context):
    logger.info({"event": event})
    response_data = {"ConnectionArn": ""}
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        physical_id = event.get("ResourceProperties").get("PhysicalResourceId")
        connection_name = event.get("ResourceProperties").get("ConnectionName")
        if request == "create" or request == "update":
            connection_arn, next_token = search_for_connection(connection_name)
            while (connection_arn is None) and next_token:
                connection_arn, next_token = search_for_connection(connection_name, next_token)
            if connection_arn:
                response_data = { "ConnectionArn": connection_arn }
                logger.info(f"CodeStar Connection ARN for '{connection_name}' found")
            else:
                logger.error(f"CodeStar Connection ARN for '{connection_name}' not found")
                cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=physical_id)
                return
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=physical_id)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physicalResourceId=physical_id)

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