import boto3
from aws_lambda_powertools import Logger

logger = Logger()
ssm = boto3.client("ssm")
s3 = boto3.client("s3")
s3_resource = boto3.resource('s3')

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
    s3_bucket = s3_resource.Bucket(bucket_name)
    bucket_versioning = s3_resource.BucketVersioning(bucket_name)
    if bucket_versioning.status == 'Enabled':
        s3_bucket.object_versions.delete()
    else:
        s3_bucket.objects.all().delete()
    # Delete the bucket
    s3.delete_bucket(Bucket=bucket_name)
    return {}
