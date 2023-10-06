from crhelper import CfnResource
import logging
import boto3
import os

helper = CfnResource()
client = boto3.client("kinesisanalytics")
logger = logging.getLogger(__name__)
application_name = os.environ["KINESIS_ANALYTICS_NAME"]
input_starting_position = os.environ["INPUT_STARTING_POSITION"]


def lambda_handler(event, context):
    helper(event, context)


@helper.create
def create(event, context):
    logger.info("Got Create")
    kinesis_analytics = client.describe_application(ApplicationName=application_name)

    response = client.start_application(
        ApplicationName=application_name,
        InputConfigurations=[
            {
                "Id": kinesis_analytics["ApplicationDetail"]["InputDescriptions"][0][
                    "InputId"
                ],
                "InputStartingPositionConfiguration": {
                    "InputStartingPosition": input_starting_position
                },
            },
        ],
    )


@helper.update
def update(event, context):
    logger.info("Got Update")


@helper.delete
def delete(event, context):
    logger.info("Got Delete")
    # response = client.stop_application(
    #    ApplicationName=application_name
    # )
