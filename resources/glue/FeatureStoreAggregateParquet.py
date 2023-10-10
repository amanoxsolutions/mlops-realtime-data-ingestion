import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

## @params: [JOB_NAME]
args = getResolvedOptions(sys.argv, ['JOB_NAME','s3_bucket_name','prefix','target_file_size_in_bytes'])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

logger = glueContext.get_logger()

# Configuration information
s3_bucket_name = args['s3_bucket_name'] # Do not include trailing / or s3://
prefix = args['prefix'] # Do not include trailing / 
target_file_size_in_bytes = int(args['target_file_size_in_bytes'])  # 536,870,912 (.5 GB) - 1,073,741,824 (1 GB) is recomended
subfolders = []

# Validate configuration information
s3_bucket_name = s3_bucket_name.rstrip('/')

# Calculate the target number of files
import boto3
import math

s3_client = boto3.client('s3')

result = s3_client.list_objects_v2(Bucket=s3_bucket_name, Delimiter='/', Prefix=prefix)
datafolder = result.get('CommonPrefixes')[0].get('Prefix') + "data/"
result = s3_client.list_objects_v2(Bucket=s3_bucket_name, Delimiter='/', Prefix=datafolder)
for year in result.get('CommonPrefixes'):
    result = s3_client.list_objects_v2(Bucket=s3_bucket_name, Delimiter='/', Prefix=year.get('Prefix'))
    for month in result.get('CommonPrefixes'):
        result = s3_client.list_objects_v2(Bucket=s3_bucket_name, Delimiter='/', Prefix=month.get('Prefix'))
        for day in result.get('CommonPrefixes'):
            result = s3_client.list_objects_v2(Bucket=s3_bucket_name, Delimiter='/', Prefix=day.get('Prefix'))
            for hour in result.get('CommonPrefixes'):
                files = s3_client.list_objects_v2(Bucket=s3_bucket_name, Prefix=hour.get('Prefix'))
                fileCount = files['KeyCount']
                if fileCount > 1:
                    subfolders.append(hour.get('Prefix').strip('/'))

session = boto3.Session()
s3 = session.resource('s3')
my_bucket = s3.Bucket(s3_bucket_name)
                
for subfolder in subfolders:
    total_prefix_size = 0
    
    logger.info('Working in subfolder: ' + subfolder)
    
    for my_bucket_object in my_bucket.objects.filter(Prefix=subfolder + '/'):
        object = s3.Object(s3_bucket_name, my_bucket_object.key)
        total_prefix_size = total_prefix_size + object.content_length
        # Optional - log each file + size in the prefix
        # logger.info(my_bucket_object.key + ": " + str(object.content_length) + " bytes")
    
    logger.info('Total prefix size of ' + subfolder + '/: ' + str(total_prefix_size) + ' bytes')
    
    target_number_of_files =  math.ceil(total_prefix_size / target_file_size_in_bytes)
    
    logger.info('Target number of files: ' + str(target_number_of_files))
    
    # Read the prefix and coalesce the dataframe to the target number of file
    prefix_df = spark.read.parquet('s3://' + s3_bucket_name + '/' + subfolder + '/*')
    prefix_df = prefix_df.coalesce(target_number_of_files)
    
    # Write data to a new temp prefix
    prefix_df.write.parquet('s3://' + s3_bucket_name + '/' + subfolder + '_temp/', mode = "overwrite")
    
    logger.info('Coalesced data to prefix: ' + subfolder + '_temp/')
    
    # Delete the prefix
    for my_bucket_object in my_bucket.objects.filter(Prefix=subfolder + '/'):
        my_bucket_object.delete()
    
    logger.info('Deleted prefix: ' + subfolder + '/')
    
    # 'Rename' the temp prefix
    for my_bucket_object in my_bucket.objects.filter(Prefix=subfolder + '_temp/'):
        old_source = {'Bucket': s3_bucket_name, 'Key': my_bucket_object.key}
        new_key = my_bucket_object.key.replace(subfolder + '_temp/', subfolder + '/', 1)
        new_obj = my_bucket.Object(new_key)
        new_obj.copy(old_source)
    
    logger.info('Copied prefix: ' + subfolder + '_temp/ to prefix' + subfolder + '/')
        
    for my_bucket_object in my_bucket.objects.filter(Prefix=subfolder + '_temp/'):
        my_bucket_object.delete()
    
    logger.info('Deleted prefix: ' + subfolder + '_temp/')
                    
                    