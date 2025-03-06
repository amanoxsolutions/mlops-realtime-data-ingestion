# Model Deploy Pipeline
## Overview
Please refer to the [main documentation](https://github.com/amanoxsolutions/mlops-realtime-data-ingestion/blob/main/doc/MLOPS.md#deploying-the-model).

## Code Layout
This repository was modified from an AWS Project in SageMaker. The sample code is organized as follows:

```
.
├── buildspec.yml                   # this file is used by the CodePipeline's Build stage to build a CloudFormation template.
├── build.py                        # contains code to get the latest approve package arn and exports staging and configuration files. This is invoked from the Build stage.
├── endpoint-config-template.yml    # this CloudFormation template file is packaged by the build step in the CodePipeline and is deployed in different stages.
├── staging-config.json             # this configuration file is used to customize `staging` stage in the pipeline. You can configure the instance type, instance count here.
├── prod-config.json                # this configuration file is used to customize `prod` stage in the pipeline. You can configure the instance type, instance count here.
├── update_monitoring_threshold.py  # contains code to update the SSM parameter storing the monitoring threshold based on the performance of the new model being deployed.
├── test\buildspec.yml              # used by the CodePipeline's `staging` stage to run the test code of the following python file
├── test\test.py                    # contains code to describe and invoke the staging endpoint. You can customize to add more tests here.
