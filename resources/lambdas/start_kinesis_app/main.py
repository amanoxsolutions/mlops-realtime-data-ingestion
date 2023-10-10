from aws_lambda_powertools import Logger
from crhelper import CfnResource
import boto3
import os

helper = CfnResource()
logger = Logger()
client = boto3.client('kinesisanalytics')
application_name = os.environ['KINESIS_ANALYTICS_NAME']
input_starting_position = os.environ['INPUT_STARTING_POSITION']

def lambda_handler(event, context):
    helper(event, context)
    
@helper.create
def create(_, __):
    logger.info("Got create event - starting Kinesis analytics application")
    logger.info(f"Kinesis analytics application name: {application_name}")
    logger.info(f"Input starting position: {input_starting_position}")
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
    logger.info("Got update event - nothing todo")
        
@helper.delete
def delete(_, __):
    logger.info("Got delete event - nothing todo")
