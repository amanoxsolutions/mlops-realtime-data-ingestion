# MLOps Realtime Data Ingestion
An end-to-end realtime machine learning pipeline on AWS including:
* realtime data ingestion into SageMaker Feature Store
* data drift detection using AWS Glue DataBrew
* data ETL
* model training & validation
* model monitoring
* model deployment

This application is currently:
* ingesting in real time Blockchain transactions,
* filtering duplicate transactions,
* aggregating in real time some transaction features to compute the minute
  * total number of transactions per minute
  * total number of transaction fees collected per minute
  * average number of transaction fees collected per minute
* saving in real time the aggregated features into the Amazon SageMaker Feature Store

> **Warning**
> This opensource project is work in progress
> Do not hesitate to contact us if you want to participate
## ToDo
The current focus is to finalize the real time data ingestion pipeline
* Create a Notebook to build a Forecasting model
* Configure AWS Glue DataBrew to detect data drift and emit CloudWatch alarms
* Automating the deletion of all the stacks when destroying the pipeline
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
