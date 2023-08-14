# Data Ingestion
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
6. Click on the __Save and run application__ button

In the window bottom window __DESTINATION_SQL_STREAM__, you will start seeing the data flowing

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
