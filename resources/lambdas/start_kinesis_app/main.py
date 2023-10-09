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
def create(_, __):
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
def update(_, __):
    pass
        
@helper.delete
def delete(_, __):
    pass
