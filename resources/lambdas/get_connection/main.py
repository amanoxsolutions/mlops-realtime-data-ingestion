import os
import boto3
import logging
import lib.cfnresponse as cfnresponse

logger = logging.getLogger()
logger.setLevel(logging.INFO)
csc = boto3.client("codestar-connections")

CONNECTION_NAME = os.environ["CONNECTION_NAME"]
PHYSICAL_ID = "CustomResourceToGetCodeStarConnectionArn"

def lambda_handler(event, context):
    response_data = {"ConnectionArn": ""}
    try:
        request =event.get("RequestType").lower()
        resource = event.get("ResourceProperties", {}).get("Resource")
        config = event.get("ResourceProperties")
        if request == "create" or request == "update":
            connection_arn, next_token = search_for_connection()
            while (connection_arn is None) and next_token:
                connection_arn, next_token = search_for_connection(next_token)
            if connection_arn:
                response_data = { "ConnectionArn": connection_arn }
                logger.info(f"CodeStar Connection ARN for '{CONNECTION_NAME}' found")
            else:
                logger.error(f"CodeStar Connection ARN for '{CONNECTION_NAME}' not found")
                cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=PHYSICAL_ID)
                return
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physicalResourceId=PHYSICAL_ID)
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=PHYSICAL_ID)

def search_for_connection(next_token: str = None) -> tuple:
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
        if connection.get("ConnectionName") == CONNECTION_NAME:
            connection_arn = connection.get("ConnectionArn")
    return connection_arn, next_token