# Data Ingestion
This documentation gives you some information to look at the data being ingested in the various AWS services et different
stages of the data pipeline.
## Data Ingestion Pipeline Architecture
![](doc/images/mlops-realtime-data-ingestion-ingestion.jpg)
The pipeline works as follow:
1. An AWS Fargate container polls the data source API every second to ingest the last 100 transactions and publish all transactions on the data ingestion event bus of AWS EventBridge.
2. An AWS EventBridge Rule routes the ingested data to Amazon Kinesis Data Firehose streaming service.
3. An AWS Lambda Function is used in combination with Amazon DynamoDB to keep track of recently ingested transactions and filter out transactions already ingested.
4. The raw data are delivered by Amazon Kinesis Data Firehose to Amazon Kinesis Data Analytics and to an Amazon S3 Bucket for archival.
5. Amazon Kinesis Data Analytics aggregates the data in near real time, computing the following 3 metrics per minute:
   - total number of transactions
   - total amount of transaction fees
   - average amount of transaction fees
6. An AWS Lambda Function writes the aggregated data into Amazon SageMaker Feature Store which is used as the centralized data store for machine learning training and predictions.
7. An AWS Glue Job periodically aggregates the small files in the Amazon SageMaker Feature Store S3 Bucket to improve performance when reading data.

## Controlling the Kinesis Firehose Data Ingestion
Once the stack is deployed, the AWS Fargate container will automatically start polling blokchain data and write them into Amazon EventBridge,
which will be sent automatically to Kinesis Firehose.
You can see the data being ingested:
* In the Amazon CloudWatch log LogStream of the Fargate container __<application prefix>-ingestion-worker__
* In the Amazon EventBridge bus rule __<application prefix>-ingestion-bus > <application prefix>-ingestion-rule__ Monitoring tab
* In the Amazon Kinesis Firehose __<application prefix>-kf-stream__ Monitoring tab
* You can also see the AWS Lambda function filtering out duplicate transactions in the CloudWatch log LogStream of thefunction __<application prefix>-stream-processing__
## Kinesis Analytics and Streaming into Feature Store
You can also watch Amazon Kinesis Analytics aggregate the data in real time.
To do so 
1. go in the __Amazon Kinesis__ Service 
2. then in the __Analytics applications > SQL applications (legacy)__  menus
3. open the Amazon Kinesis Analytics application __<application prefix>-analytics__
4. go in the __Real-time analytics__ menu
5. Click on the __Configure__ button

In the window bottom window __DESTINATION_SQL_STREAM__, you will start seeing the data flowing
## Use Athena to read data from SageMaker Feature Store Offline Store
You can use Amazon Athena to query the data in the SageMaker Feature Store.
1. go in the __Amazon Athena__ Service
2. then in the __Query Editor__ left menu
3. when asked, select (create if you don't have one already) the S3 bucket where the Athena query results will be stored
4. in the __Data__ menu, select the database __sagemaker_feature__ and the  feature group table (it should look like 
__<application prefix>_agg_feature_group\_xxxxxxxxx__ and click on the __Preview Table__ button"
5. To see the latest data, you can add the ``ORDER BY tx_minute DESC`` clause in the SQL query
## Use SageMaker Studio Notebook to read data from SageMaker Feature Store
The application is streaming the data in real-time into Amazon SageMaker Feature Store.

First you can check the Amazon SageMaker Feature Store:
1. go in the __Amazon SageMaker__ Service
2. then in the __Domain__ left menu
3. click on the domain (there can only be one, so if you have already one in your account and region, the stack is reusing it)
4. in the __User Profile__ tab click on the __Launch__ button on the right of the user with the name __<application prefix>-sagemaker-user__
5. Select __Studio__
6. Wait for SageMaker Studio to load then go into the __SageMaker resources__ left menu and select __Feature Store__
7. Click on the Feature Store named __<application prefix>-agg-feature-group__ and you will see the features
available in that Feature Store
