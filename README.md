# MLOps Realtime Data Ingestion
An end-to-end realtime machine learning pipeline on AWS including:
* realtime data ingestion into SageMaker Feature Store
* data drift detection using AWS Glue DataBrew
* data ETL
* model training & validation
* model monitoring
* model deployment

## ToDo
The current focus is to finalize the real time data ingestion pipeline
* Change the architecture to replace the legacy Kinesis Data Analytics by a combination of Kinesis Data Streams with 
Managed Apache Flink
* Automating the deletion of all the stacks when destroying the pipeline

## The Data
For this project, we decided to ingest blockchain transactions from the blockchain.com API (see documentation here). 
We focus on 3 simple metrics:
* The total number of transactions
* The total amount of transaction fees
* The average amount of transaction fees

These metrics are computed per minute. Although it might not be the best window period to analyze blockchain 
transactions, it allows us to quickly gather a lot of data points in a short period of time, avoiding to run the demo 
for too long which has an impact on the AWS billing.

## Architecture
The current architecture only covers the real time data ingestion into S3 and SageMaker Feature Store
![](doc/images/mlops-realtime-data-ingestion.jpg)

## What are the Prerequisites?
The list below is for _Windows_ environment
* The AWS CLI ([documentation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))  
* Docker Desktop ([Documentation](https://docs.docker.com/desktop/windows/install/))  
* NPM and Node.js ([Documenttaion](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm))
* The AWS CDK: `npm install -g aws-cdk`

## Documentation
Most of the architecture is fully automated through the CDK. 
You do not have much to configure and can directly play with the application and watch it ingest and aggregate the data in near real time.
* [Deploy the Data Ingestion Environment](./doc/DEPLOYMENT.md)
* [The Data Ingestion](./doc/INGESTION.md)

## Cost
This demo deploys many services (e.g. Fargate, DynamoDB, Kinesis Firehose, Kinesys Analytics) and must be run for 
several days to collect enough data to be able to start training a model. This demo do generate costs which could be 
expensive, depending on your budget. The full demo costs about $850 per month in the Ireland region.
