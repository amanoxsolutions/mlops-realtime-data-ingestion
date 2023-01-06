import os
import boto3
import logging
import lib.cfnresponse as cfnresponse

logger = logging.getLogger()
logger.setLevel(logging.INFO)
sagemaker = boto3.client("sagemaker")

PHYSICAL_ID = "CustomResourceToCheckForExistingSageMakerStudioDomain"

def lambda_handler(event, context):
    response_data = {
        "SagemakerDomainName": "",
        "SagemakerDomainId": ""
    }
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        # As of now there can only be one SageMaker Studio Domain
        sm_response = sagemaker.list_domains()
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=PHYSICAL_ID)
    else:
        domains_list = sm_response.get("Domains", [])
        if domains_list:
            response_data["SagemakerDomainName"] = domains_list[0].get("DomainName")
            response_data["SagemakerDomainId"] = domains_list[0].get("DomainId")
            logger.info(f"Existing SageMaker Studio Domain: {response_data}")
        else:
            logger.info("No SageMaker Studio Domain found")
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physicalResourceId=PHYSICAL_ID)

