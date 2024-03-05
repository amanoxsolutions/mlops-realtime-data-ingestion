# Delete the Entire Project
This project contains 3 main parts:
* The resources deployed through the CDK
* The SageMaker MLOps Project deployed using the Service Catalog through the CDK 
* The different SageMaker resources deployed throughout the life of the MLOps pipeline (e.g. model endpoints, model monitoring resources, etc.)

These resources have to be deleted following the below steps.
## 1. Delete the SageMaker resources
Throughout the life of the MLOps lifecycle, different resources are deployed outside of the Infrastructure as Code stack of both the CDK Infrastructure stack and the AWS Service Catalog MLOps project stack.
We provide a Step Function, to orchestrate the cleanup of all those resources
## 2. Delete ths SageMaker MLOps project
The CDK SageMaker stack uses AWS Service Catalog to deploy a the SageMaker MLOps project. Service Catalog uses CloudFormation the background to deploy 3 stacks as shown in the screen capture below.
![](doc/images/sagemaker-project-cloudformation-stacks.jpg)
Delete each of these stacks manually from top to bottom.
## 3. Delete the CDK Stacks
Unfortunately running the CLI command 
```
cdk destroy
```
will only destroy the CI/CD pipeline stack. Not the data ingestion and the SageMaker stacks. 
To delete all resources, go into CloudFormation and delete the stacks manually. You should have 4 remaining CloudFormation stacks as shown in the following screen capture (stack prefixes will be unique to your deployment)
![](doc/images/cdk-stacks.jpg)
Delete each of these stacks manually from top to bottom:
1. Delete the mlops-********-RealtimeDataIngestion-SagemakerStack
2. Delete the mlops-********-RealtimeDataIngestion-IngestionStack
3. Delete the mlops-********-RealtimeDataIngestion-CommonResourcesStack
4. Delete the mlops-********-DataIngestionPipelineStack
