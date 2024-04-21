from aws_lambda_powertools import Logger
from crhelper import CfnResource
import boto3
import os

helper = CfnResource()
logger = Logger()
client = boto3.client('kinesisanalyticsv2')
application_name = os.environ['FLINK_APPLICATION_NAME']

@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    helper(event, context)
    
@helper.create
def create(_, __):
    logger.info(f"Flink application name: {application_name}")
    application_status = get_application_status(application_name)
    logger.info(f"Application status: {application_status}")
    if application_status == 'RUNNING':
        logger.info("Application is already running")
        return
    elif application_status != 'READY':
        logger.info("Cannot start the application in the current state: {application_status}. The application must be in the READY state to start it.")
        return
    logger.info("Starting the application: {application_name}")
    client.start_application(
        ApplicationName=application_name,
        RunConfiguration={
            "ApplicationRestoreConfiguration": {
                "ApplicationRestoreType": "SKIP_RESTORE_FROM_SNAPSHOT"
            }
        }
    )
    application_status = get_application_status(application_name)
    logger.info(f"Application status: {application_status}")
    
@helper.update
@helper.delete
def do_nothing(_, __):
    logger.info("Nothing to do")

def get_application_status(application_name: str) -> str:
    flink_app = client.describe_application(
        ApplicationName=application_name,
        IncludeAdditionalDetails=False
    )
    return flink_app['ApplicationDetail']['ApplicationStatus']
