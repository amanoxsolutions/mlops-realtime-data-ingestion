# Deploy the Data Ingestion Environment

## 1. Fork this Repository

## 2. Create an AWS Codestar Connection
Please refer to the AWS document [Create a connection to GitHub](https://docs.aws.amazon.com/dtconsole/latest/userguide/connections-create-github.html)

## 3. Edit the Data Ingestion Configuration
In the `bin/data-ingestion.ts` file configure the 
* repository name
* your AWS CodeStar connection name

```
new DataIngestionPipelineStack(app, 'DataIngestionPipelineStack', {
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  codestarConnectionName: 'mlops-realtime-data-ingestion',
});
```

## 4. Deploy the CI/CD Pipeline
If you have multiple AWS CLI configuration profiles use the `--profile <your profile name>` to use it for authentication.

Bootsrap the CDK
```
cdk bootstrap aws://<account number>/<aws region>
```

e.g.
```
cdk bootstrap aws://123456789012/eu-west-1
```


Install the Node.js modules defined in the package.json file
```
npm install
```

Verify the stack before deploment
```
cdk synth
```

Deploy the stack from the current Git branch
```
cdk deploy
```

To deploy the stack of a specific branch
```
cdk deploy --context branchToDeploy=feature/myFeatureBranch
```

This will deploy a self-mutating CI/CD pipeline. When you push code into you repository, the pipeline will be automatically triggered.
It will 
1. update itself if new stages have been added in the CI/CD pipeline.
2. package the code assets for the different stacks' deployment.
3. deploy the stacks in sequential orders using CloudFormation.

## 5. Destroy the Stacks
Unfortunately running the command 
```
cdk destroy
```
will only destroy the CI/CD pipeline stack. Not the data ingestion and the SageMaker stacks. 
To delete all resources, go into CloudFormation and delete the stacks manually.
(Automating this is a TODO)