# Delete the Entire Project
This project contains 3 main parts:
* The resources deployed through the CDK
* The SageMaker MLOps Project deployed using the Service Catalog through the CDK 
* The different SageMaker resources deployed throughout the life of the MLOps pipeline (e.g. model endpoints, model monitoring resources, etc.)

These resources have to be deleted following the below steps.
## 1. Delete the SageMaker MLOps project
The CDK SageMaker stack uses AWS Service Catalog to deploy a the SageMaker MLOps project. Service Catalog uses CloudFormation in the background to deploy 2 stacks as shown in the screen capture below.
![](doc/images/sagemaker-project-cloudformation-stacks.jpg)
Delete each of these 2 stacks manually from top to bottom. The project stack will be deleted when deleting the CDK Sagemaker stack.
## 2. Delete the SageMaker resources
Throughout the life of the MLOps lifecycle, different resources are deployed outside of the Infrastructure as Code stack of both the CDK Infrastructure stack and the AWS Service Catalog MLOps project stack.
We provide a Step Function, to orchestrate the cleanup of all those resources
## 3. Cleanup the raw data ingestion bucket (optional)
The S3 bucket storing the raw data ingested through Kinesis Firehose is configured to automatically delete the objects.
Depending on how long you ran the demo and how much data are stored it can take quite some time for the cleanup of the S3 bucket to complete through CloudFormation.
If you want to fasten the deletion of the `mlops-********-RealtimeDataIngestion-IngestionStack` stack, we recommend to manually empty the data ingestion bucket `mlops-********-input-bucket-********` before hand.
## 4. Delete the CDK Stacks
Unfortunately running the CLI command 
```
cdk destroy
```
will only destroy the CI/CD pipeline stack, not the data ingestion and the SageMaker stacks. 
To delete all resources, go into CloudFormation and delete the stacks manually. You should have 4 remaining CloudFormation stacks as shown in the following screen capture (stack prefixes will be unique to your deployment)
![](doc/images/cdk-stacks.jpg)
Delete each of these stacks manually from top to bottom:
1. Delete the mlops-********-RealtimeDataIngestion-SagemakerStack
2. Delete the mlops-********-RealtimeDataIngestion-IngestionStack
3. Delete the mlops-********-RealtimeDataIngestion-CommonResourcesStack
4. Delete the mlops-********-DataIngestionPipelineStack
