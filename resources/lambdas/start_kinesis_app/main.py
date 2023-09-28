from crhelper import CfnResource
import json
import boto3
import os

helper = CfnResource()
client = boto3.client('kinesisanalytics')
application_name = os.environ['KINESIS_ANALYTICS_NAME']
input_starting_position = os.environ['INPUT_STARTING_POSITION']

def lambda_handler(event, context):
    helper(event, context)
    
@helper.create
def create(event, context):
    kinesis_analytics = client.describe_application(
        ApplicationName=application_name
    )
    
    response = client.start_application(
        ApplicationName=application_name,
        InputConfigurations=[
            {
                'Id': kinesis_analytics["ApplicationDetail"]["InputDescriptions"][0]["InputId"],
                'InputStartingPositionConfiguration': {
                    'InputStartingPosition': input_starting_position
                }
            },
        ]
    )
    
@helper.update
def update(event, context):
    try:
        return {
            'Status': 'SUCCESS',
            'Reason': '',
            'LogicalResourceId': event.LogicalResourceId,
            'RequestId': event.RequestId,
            'StackId': event.StackId
        }
    except Exception as error:
        return {
            'Status': 'FAILED',
            'Reason': json.dumps(error),
            'LogicalResourceId': event.LogicalResourceId,
            'RequestId': event.RequestId,
            'StackId': event.StackId
        }
        
@helper.delete
def delete(event, context):
    response = client.stop_application(
        ApplicationName=application_name
    )
