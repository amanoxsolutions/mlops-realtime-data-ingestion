import os
import boto3
import logging
import lib.cfnresponse as cfnresponse
from typing import List, Tuple

logger = logging.getLogger()
logger.setLevel(logging.INFO)
sagemaker = boto3.client("sagemaker")

PHYSICAL_ID = "CustomResourceToCheckForExistingSageMakerStudioDomain"

def lambda_handler(event, context):
    response_data = {"SageMakerDomains": ""}
    sagemaker_domains_list = []
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")

        # As of now there can only be one SageMaker Studio Domain
        # per AWS Account and Region but let's try to be future proof
        # by following the function specification and search for the entire list of domains
        next_token, sagemaker_domains_list = list_existing_sagemaker_domains()
        while next_token:
            next_token, additional_domain_list = list_existing_sagemaker_domains(next_token)
            sagemaker_domains_list.extend(additional_domain_list)         
        # we can only return data as simple key-value pairs
        # so we convert the list of domains to a comma separated string
        sagemaker_domains = ",".join(sagemaker_domains_list)
        response_data = {"SageMakerDomains": sagemaker_domains}
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, response_data, physicalResourceId=PHYSICAL_ID)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physicalResourceId=PHYSICAL_ID)

def list_existing_sagemaker_domains(next_token: str = None) -> Tuple[str, List[str]]:
    """This function list existing SageMaker Studio Domains
    """
    if not next_token:
        sm_response = sagemaker.list_domains()
    else:
        sm_response = sagemaker.list_domains(NextToken=next_token)
    # Get all the domain naimes in the domain list
    domains_list = [domain.get("DomainName") for domain in sm_response.get("Domains", [])]
    next_token = sm_response.get("NextToken")
    logger.info(f"Existing SageMaker Studio Domains: {domains_list}")
    return next_token, domains_list
