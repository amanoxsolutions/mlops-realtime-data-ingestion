# Data Ingestion
This documentation gives you some information to look at the data being ingested in the various AWS services at different
stages of the data pipeline.
## Data Ingestion Pipeline Architecture
![](./images/data-ingestion-details.jpg)
The pipeline works as follow:
1. An AWS Fargate container polls the data source API every second to ingest the last 100 transactions and publish all transactions on the data ingestion event bus of AWS EventBridge.
2. An AWS EventBridge Rule routes the ingested data to an AWS Lambda Function.
3. The AWS Lambda Function is used in combination with Amazon DynamoDB to keep track of recently ingested transactions and filter out transactions already ingested.
4. Filtered transactions are written by the AWS Lambda Function into an _ingestion_ Amazon Kinesis Data Stream.
5. An Amazon Kinesis Firehose stream gets the data from the _ingestion_ stream and delivers the raw data to an Amazon S3 Bucket for archival.
6. An Amazon Managed Service for Apache Flink application gets the data from the _ingestion_ stream and aggregates them using a 1 minute tumbling window. The Flink application then puts the data into a _delivery_ Amazon Kinesis Data Stream. The application is computing the following 3 metrics per minute:
   - total number of transactions
   - total amount of transaction fees
   - average amount of transaction fees
7. An AWS Lambda Function gets the aggregated data and writes them into Amazon SageMaker Feature Store which is used as the centralized data store for machine learning training and predictions.
8. An AWS Glue Job periodically aggregates the small files in the Amazon SageMaker Feature Store S3 Bucket to improve performance when reading data.
## Controlling the Data Ingestion Pipeline
Once the stack is deployed, the AWS Fargate container will automatically start polling blockchain data and write them into Amazon EventBridge, which will be filtered by the AWS Lambda Function and written into the _ingestion_ Amazon Kinesis Data Stream.
An Amazon CloudWatch dashboard is automatically deployed by the Stacks to monitor the ingestion pipeline. It shows:
* The amount of bytes ingested by the AWS Fargate container.
* The total (not jus to the pipeline bus) amount of bytes written to EventBridge.
* The amount of bytes ingested by the _ingestion_ Amazon Kinesis Data Stream.
* The amount of bytes read by Amazon Kinesis Firehose from the  _ingestion_ stream
* The amount of bytes  delivered to S3 by Amazon Kinesis Firehose
* The amount of records output by the Apache Flink Application consumer (reading from the _ingestion_ stream)
* The amount of records ingested from the consumer by the Apache Flink Application producer
* The amount of bytes ingested by the _delivery_ Amazon Kinesis Data Stream.
## Use Athena to read data from SageMaker Feature Store Offline Store
You can use Amazon Athena to query the data in the SageMaker Feature Store.
1. Go in the __Amazon Athena__ Service
2. Then in the __Query Editor__ left menu
3. When asked, select (create if you don't have one already) the S3 bucket where the Athena query results will be stored
4. In the __Data__ menu, select the database __sagemaker_feature__ and the  feature group table (it should look like
__\<application prefix\>_agg_feature_group\_xxxxxxxxx__ and click on the __Preview Table__ button"
5. To see the latest data, you can add the ``ORDER BY tx_minute DESC`` clause in the SQL query
## Use SageMaker Studio Notebook to read data from SageMaker Feature Store
The application is streaming the data in real-time into Amazon SageMaker Feature Store.

First you can check the Amazon SageMaker Feature Store:
1. Go in the __Amazon SageMaker__ Service
2. Then in the __Domain__ left menu
3. Click on the domain (there can only be one, so if you have already one in your account and region, the stack is reusing it)
4. In the __User Profile__ tab click on the __Launch__ button on the right of the user with the name __\<application prefix\>-sagemaker-user__
5. Select __Studio__
6. Wait for SageMaker Studio to load then go into the __SageMaker resources__ left menu and select __Feature Store__
7. Click on the Feature Store named __\<application prefix\>-agg-feature-group__ and you will see the features
available in that Feature Store

Then to use the provided Jupyter Notebook to check the ingested data: 
1. From the SageMaker Studio interface, create a code editor environment
2. Once, created and launched, upload the `\resources\sagemaker\read_feature_store.ipynb` notebook
3. Run the notebook

The notebook is pulling all the information from the SSM parameters. It should thus run and read the data from the
proper feature store, without you having to edit any of the code.
