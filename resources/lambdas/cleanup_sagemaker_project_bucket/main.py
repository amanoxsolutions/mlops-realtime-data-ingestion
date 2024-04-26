import boto3
from aws_lambda_powertools import Logger

logger = Logger()
ssm = boto3.client("ssm")
s3 = boto3.client("s3")

@logger.inject_lambda_context(log_event=True)
def lambda_handler(event, context):
    # Get the SageMaker project bucket name from SSM parameter store
    bucket_name = ssm.get_parameter(Name="/rdi-mlops/stack-parameters/sagemaker-project-bucket-name").get("Parameter").get("Value")
    # Check if the S3 bucket exists
    try:
        s3.head_bucket(Bucket=bucket_name)
    except s3.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            logger.info(f"Bucket {bucket_name} not found. Nothing to delete.")
            return {}
        else:
            raise
    # Create a list of the objects in the bucket and delete them in batches
    paginator = s3.get_paginator("list_objects_v2")
    object_list = []
    for page in paginator.paginate(Bucket=bucket_name):
        for obj in page.get("Contents", []):
            object_list.append({"Key": obj["Key"]})
    logger.info(f"Found {len(object_list)} objects to delete")
    # Delete all objects in the list in batches of at most 1000 objects
    for i in range(0, len(object_list), 1000):
        delete_keys = {"Objects": object_list[i : i + 1000]}
        s3.delete_objects(Bucket=bucket_name, Delete=delete_keys)
        logger.info(f"Deleted {len(delete_keys['Objects'])} objects")
    # Delete the bucket
    s3.delete_bucket(Bucket=bucket_name)
    return {}
