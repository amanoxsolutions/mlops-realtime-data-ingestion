# MLOps Realtime Data Ingestion
An end-to-end realtime machine learning pipeline on AWS including:
* realtime data ingestion into SageMaker Feature Store
* data ETL
* model training & validation
* model deployment
* model monitoring

## To Dos & Improvements
* __Amazon Kinesis Data Analytics__ is legacy and should be replaced by a combination of __Amazon Kinesis Data Stream__ & __Amazon Managed Service for Apache Flink__

## The Data
For this project, we decided to ingest blockchain transactions from the blockchain.com API (see documentation [here](https://www.blockchain.com/explorer/api)). 
We focus on 3 simple metrics:
* The total number of transactions
* The total amount of transaction fees
* The average amount of transaction fees

These metrics are computed per minute. Although it might not be the best window period to analyze blockchain 
transactions, it allows us to quickly gather a lot of data points in a short period of time, avoiding to run the demo 
for too long which has an impact on the AWS billing.
## Architecture
## The Full Architecture
![](doc/images/mlops-realtime-data-ingestion.jpg)
## Near Real Time Data Ingestion Architecture
At a high level, the data are ingested as follow:
1. A container running on AWS Fargate polls the data and writes them to EventBridge
2. EventBridge sends the data to Kinesis Data Firehose
3. Kinesis Data Firehose streams the data to Kinesis Data Analytics
4. Kinesis Data Analytics computes the chosen metrics per minute and writes them to SageMaker Feature Store

See [this documentation](./doc/INGESTION.md) for more details.
![](doc/images/mlops-realtime-data-ingestion-ingestion-overview.jpg)
## MLOps Architecture
The MLOps project contains 3 CodeCommit repositories with their own CodePipeline pipelines to train, deploy and monitor the model.
1. The __Model Build__ pipeline creates a SageMaker Pipeline orchestrating all the steps to train a model and, if it passes the validation threshold, register the model, which then has to be manually approved.
2. If the registered model is approved, the __Model Deploy__ pipeline is automatically triggered and deploys the model behind 2 SageMaker API Endpoints, one for the staging environment and one for the production environment. 
3. If the new model baseline performance is better than the existing one, we update the model monitoring alarm threshold with the new model performance. Note that in a real world scenario you might not want to update the model monitoring threshold like that, as it might be dictated by business criteria. We do this in this demo to test automated retraining and improvement of the model.
4. Once the endpoints are __IN_SERVICE__, it triggers automatically the __Model Monitor__ pipeline, which deploys resources to monitor the pipeline
5. Every hour, a SageMaker Pipeline is executed to test the model against the latest data. The performance of the model is tracked by the SageMaker Monitoring service and a custom CloudWatch Alarm. We use a custom CloudWatch Alarm because, as of now
   * AWS does not support monitoring for custom metrics (like the [weighted quantile loss](https://docs.aws.amazon.com/sagemaker/latest/dg/deepar.html) we use for the DeepAR model) and,
   * AWS does not provide any built-in mechanism to capture the SageMaker Monitoring raising an alarm when a model performance is breached.
6. If our custom metric is breached, the CloudWatch Alarm will trigger a Lambda Function, which will trigger the __Model Build__ pipeline, retraining a new model, looping back automatically to the step one of this MLOps pipeline.
![](doc/images/mlops-realtime-data-ingestion-mlops.jpg)
## What are the Prerequisites?
The list below is for _Windows_ environment
* The AWS CLI ([documentation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))  
* Docker Desktop ([Documentation](https://docs.docker.com/desktop/windows/install/))  
* NPM and Node.js ([Documenttaion](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm))
* The AWS CDK: `npm install -g aws-cdk`
* Configure your programmatic access to AWS for the CLI (see instructions [here](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_auth)).
## Documentation
Most of the architecture is fully automated through the CDK. 
You do not have much to configure and can directly play with the application and watch it ingest and aggregate the data in near real time. Once you have ingested some data you can start to train a forecasting model by running the corresponding pipeline and see the entire MLOps process automation.
* [Deploy the Environment](./doc/DEPLOYMENT.md)
* [The Data Ingestion](./doc/INGESTION.md)
* [The MLOps Pipeline](./doc/MLOPS.md)
* [Delete the Entire Project](./doc/DELETION.md)
## Cost
This demo deploys many services (e.g. Fargate, DynamoDB, Kinesis Firehose, Kinesys Analytics) and must be run for 
several days to collect enough data to be able to start training a model. This demo do generate costs which could be 
expensive, depending on your budget. The full demo costs about $850 per month in the Ireland region.
