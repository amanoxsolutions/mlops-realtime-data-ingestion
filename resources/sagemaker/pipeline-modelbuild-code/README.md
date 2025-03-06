# Model Build Pipeline

## Overview
Please refer to the [main documentation](https://github.com/amanoxsolutions/mlops-realtime-data-ingestion/blob/main/doc/MLOPS.md#building-the-model-with-the-sagemaker-pipeline).
## Layout of the SageMaker ModelBuild Project Template

The template provides a starting point for bringing your SageMaker Pipeline development to production.

```
├── codebuild-buildspec.yml
|-- pipelines
|   |-- blockchain
|   |   |--  *.py                       # code for the pipeline and the data preprocessing and custom model evaluation steps within the pipeline
|   |-- deploy_model_build_params.py    # code to deploy the SSM parameters storing the values to train and monitor the model. The initial values come from `/model-build-params.json`
|   |-- get_pipeline_definition.py
|   |-- run_pipeline.py                 # script executing the pipeline and passing it parameters
|   |-- _utils.py                       # code of some utility functions
|-- setup.cfg
|-- setup.py
|-- tests
|   `-- test_pipelines.py               # A stubbed testing module for testing your pipeline as you develop
```
