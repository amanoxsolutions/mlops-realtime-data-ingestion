import json
import logging
import urllib3

http = urllib3.PoolManager()
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    cf_callback_url = event.get("cf_callback_url")
    status = event.get("status")
    logger.info(f"Sending status '{status}' to CloudFormation callback URL: {cf_callback_url}")
    
    responseBody = {
        "Status": status,
        "UniqueId": "1",
        "Data": "All SageMaker Studion Domain apps have been deleted",
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
