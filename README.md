# MLOps Realtime Data Ingestion
An end-to-end realtime machine learning pipeline on AWS including:
* realtime data ingestion
* data drift detection using AWS Glue DataBrew
* data ETL
* model training & validation
* model monitoring
* model deployment

> **Warning**
> This opensource project is work in progress
> Do not hesitate to contact us if you want to participate
## Architecture
![](doc/images/mlops-realtime-data-ingestion.jpg)

# What are the Prerequisites?
The list below is for _Windows_ environment
* The AWS CLI ([documentation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))  
* Docker Desktop ([Documentation](https://docs.docker.com/desktop/windows/install/))  
* NPM and Node.js ([Documenttaion](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm))
* The AWS CDK: `npm install -g aws-cdk`

## Deploy the Data Ingestion Environment

### 1. Fork this Repository

### 2. Create an AWS Codestar Connection
Please refer to the AWS document [Create a connection to GitHub](https://docs.aws.amazon.com/dtconsole/latest/userguide/connections-create-github.html)

### 3. Edit the Data Ingestion Configuration
In the `bin/data-ingestion.ts` file

```

```

### 4. Deploy the CI/CD Pipeline
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

Deploy the stack
```
cdk deploy
```

