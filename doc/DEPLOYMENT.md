# Deploy the Data Ingestion Environment
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

## 4. Deploy the CI/CD Pipeline
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

