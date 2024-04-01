# Deploy the Data Ingestion Environment & MLOps Pipelines
## What are the Prerequisites?
The list below is for _Windows_ environment
* The AWS CLI ([documentation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))  
* Docker Desktop ([Documentation](https://docs.docker.com/desktop/windows/install/))  
* NPM and Node.js ([Documenttaion](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm))
* The AWS CDK: `npm install -g aws-cdk`
* Configure your programmatic access to AWS for the CLI (see instructions [here](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_auth)).
## 1. Fork this Repository
## 2. Create an AWS Codestar Connection
Please refer to the AWS document [Create a connection to GitHub](https://docs.aws.amazon.com/dtconsole/latest/userguide/connections-create-github.html)
## 3. Edit the Data Ingestion Configuration
In [the `bin/data-ingestion.ts` file](https://github.com/amanoxsolutions/mlops-realtime-data-ingestion/blob/main/bin/data-ingestion.ts#L35-L36) configure the 
* repository name
* your AWS CodeStar connection name
```
new DataIngestionPipelineStack(app, 'DataIngestionPipelineStack', {
  [...]
  repoName: 'amanoxsolutions/mlops-realtime-data-ingestion',
  codestarConnectionName: 'mlops-realtime-data-ingestion',
});
```
## 4. Deploy the Environment
> [!TIP]
> If your AWS CLI is using a named profile instead of the default profile,  specify this profile when issuing AWS CLI & CDK commands using the `--profile <your profile name>` option or the AWS_PROFILE environment variable.

Bootsrap the CDK (documentation [here](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_bootstrap))
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
## 5. Deploy the MLOps Pipelines
Deploying the CDK project will deploy 3 CloudFormation stacks 
* Common 
* Data Ingestion 
* SageMaker

The last one, through the use of Service Catalog will deploy a 4th CloudFormation stack for the MLOps SageMaker project. As [described in the overall architecture](../README.md), this will deploy 3 CodeCommit repositories, each with a corresponding CodePipeline pipeline.
At first all those pipelines will fail; __this is normal__ since the code contained in those pipelines does not fit the project and how could the __Model Deploy__ pipeline deploy a model and the __Model Monitor__ pipeline deploy the resources to monitor a model, when none has been trained yet?

The code for each pipeline is provided to you in the `\resources\sagemaker` folder. You will have to clone each of the CodeCommit repositories, replace the entire content with the one provided for each pipeline and commit the project code for each repository. 

The project provides you a SageMaker development environment with all the necessary credentials already granted, which will simplify performing the operation. In the AWS Console,
1. Go to the __CodeCommit__ and copy the HTTPS link to clone each of the __Model Build__, __Model Deploy__ and __Model Monitor__ pipelines
2. Then go the the __SageMaker__ service
3. On the left panel, go to __Admin configurations > Domains__
4. You should see a SageMaker domain similar to `mlops-********-sagemaker-studio-domain`, click on it
5. A user `mlops-********-sagemaker-studio-user` has also been provision. Click on the `Launch` button and select `Studio`
6. Within your SageMaker Studio development environment, select `Code Editor` and create, run and open a code editor environment
7. Once in the environment, open a Terminal window and run the `git clone` command for each of the model pipeline repositories you copied in step [1]
8. Delete the entire content of each repository
9. Upload the code from the `\resources\sagemaker` folder from your computer
10. Commit & push all the changes for each repository

The __Model Build__ pipeline will start right away, provision and running the SageMaker pipeline to train a model. But note that the __Model Deploy__ pipeline will also run and fail. At this stage this is normal since no model has been trained yet. Once the __Model Build__ pipeline completes and a model is waiting for your approval to be deployed, the __Model Deploy__ pipeline will be triggered automatically.
See the [The MLOps Pipeline](./doc/MLOPS.md) documentation for more details.