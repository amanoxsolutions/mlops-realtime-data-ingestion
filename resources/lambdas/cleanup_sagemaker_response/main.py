import json
import logging
import urllib3

http = urllib3.PoolManager()
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    cf_callback_url = event.get("cf_callback_url")
    status = event.get("status")
    logger.info(f"The status of the cleanup of the SageMaker Studio domain is: '{status}'")
    cfn_status = "SUCCESS" if status == "DELETED" else "FAILED"
    logger.info(f" Sending status '{cfn_status}' to CloudFormation callback url: {cf_callback_url}")
    
    responseBody = {
        "Status": cfn_status,
        "UniqueId": "1",
        "Data": "All SageMaker StudionDomain apps have been deleted",
        "Reason": "SageMaker Studion Domain apps deletion completed"
    }
    json_responseBody = json.dumps(responseBody)
    logger.info(f"Response body:\n{json_responseBody}")
    headers = {
        'content-type' : '',
        'content-length' : str(len(json_responseBody))
    }
    try:
        response = http.request('PUT', cf_callback_url,
                                body=json_responseBody.encode('utf-8'), headers=headers)
        logger.info("Status code: " + response.reason)
    except Exception as e:
        logger.info("send(..) failed executing requests.put(..): " + str(e))
