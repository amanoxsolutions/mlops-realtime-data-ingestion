# Model Monitor Template

## Overview

The Model Monitor template automates the model monitor setup.
The template provides the following types of Amazon SageMaker Model Monitor:

- [Monitor Data Quality](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-data-quality.html) -
  Monitor drift in data quality.
- [Monitor Model Quality](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-model-quality.html) -
  Monitor drift in model quality metrics, such as accuracy.
- [Monitor Bias Drift for Models in Production](https://docs.aws.amazon.com/sagemaker/latest/dg/clarify-model-monitor-bias-drift.html) -
  Monitor bias in model's predictions.
- [Monitor Feature Attribution Drift for Models in Production](https://docs.aws.amazon.com/sagemaker/latest/dg/clarify-model-monitor-feature-attribution-drift.html) -
  Monitor drift in feature attribution.

## Triggering the Model Monitor's CodePipeline

Please note, the execution of the model monitor codepipeline, provisioned by the model build, deploy, and model monitor
template, will fail the first time because there is no endpoint to monitor yet. Once a model
is trained, approved, and deployed to an Amazon SageMaker endpoint in the staging environment, the model
monitor codepipeline will be triggered automatically once the endpoint's status change to `InService`.

Any new updates to the endpoint, such as deploying a new model version, will re-trigger the model monitor
codepipeline again, to ensure that the monitors use the latests changes, such as new model monitor baselines.

## Enabling/Disabling Monitors

By default, all four Amazon SageMaker Model Monitor types are enabled. However, you can
disable/enable one, or more, monitor's type by setting `"Enable<Monitor-Type>Monitor"` to `"no"`,
in the [staging-monitoring-schedule-config.json](staging-monitoring-schedule-config.json)
and [prod-monitoring-schedule-config.json](prod-monitoring-schedule-config.json) files.

```
{
  "Parameters": {
    ...
    "EnableDataQualityMonitor": "yes",
    "EnableModelQualityMonitor": "yes",
    "EnableModelBiasMonitor": "yes",
    "EnableModelExplainabilityMonitor": "yes",
    ...
  }
}
```

**Note**: If `ModelQuality` and `ModelBias` monitors are enabled, you need to update the [staging-monitoring-schedule-config.json](staging-monitoring-schedule-config.json) and [prod-monitoring-schedule-config.json](prod-monitoring-schedule-config.json) files, and
provide your ground truth data's S3 URI. For more information,
refer to [Ingest Ground Truth Labels and Merge Them With Predictions](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-model-quality-merge.html).

```
{
  "Parameters": {
    ...
    "GroundTruthInput": "",
    ...
  }
}
```

The template only deploys these monitors if both `"EnableModelQualityMonitor"`/
`"EnableModelBiasMonitor"` is `"yes"`, and `"GroundTruthInput"` is not an empty string. You can provide the ground truth data later by updating the `"GroundTruthInput"` attribute in the configuration files with data's S3 URI.

### Updating Parameters Specific to the Problem Type

The `ModelQuality`, `ModelBias`, and `ModelExplainability` monitors use one, or more, of
the following parameters. These parameters depend on the `ProblemType` and your deployed model.
Only provide a value for the required parameter(s), based on your case, and leave others as empty
string. For more information, refer to [ModelQualityJobDefinition](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sagemaker-modelqualityjobdefinition.html),
[ModelBiasJobDefinition](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sagemaker-modelbiasjobdefinition.html),
and [ModelExplainabilityJobDefinition](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sagemaker-modelexplainabilityjobdefinition.html)

```
{
  "Parameters": {
    ...
    "ProblemType": "Regression",
    "InferenceAttribute": "0",
    "ProbabilityAttribute": "",
    "FeaturesAttribute": "",
    "ProbabilityThresholdAttribute": "",
    ...
  }
}
```

## Using Custom Baselines/Configuration Files

The template uses baselines and configuration files created by the model building pipeline, and registered in the Amazon SageMaker Model Registry. However, you could provide your baselines/configuration files for one, or more, monitor's type, in the [staging-monitoring-schedule-config.json](staging-monitoring-schedule-config.json) and [prod-monitoring-schedule-config.json](prod-monitoring-schedule-config.json) files, by adding the relevant attributes. If one, or more, attribute is added to the configuration files, the template ignores the baseline(s) returned from the model registry, and uses your custom file(s).

```
{
  "Parameters": {
    ...
    "DataQualityConstraintsS3Uri":  "s3://...",
    "DataQualityStatisticsS3Uri": "s3://...",
    "ModelQualityConstraintsS3Uri": "s3://...",
    "ModelBiasConstraintsS3Uri": "s3://...",
    "ModelBiasConfigS3Uri": "s3://...",
    "ModelExplainabilityConstraintsS3Uri":
    "ModelExplainabilityConfigS3Uri": "s3://...",
    ...
  }
}
```

## Sample Code Layout

This AWS CodeCommit repository is created as part of creating a Project in SageMaker. The sample code is organized as follows:

```
.
├── README.md
├── __init__.py
├── buildspec.yml                           # used by the AWS CodeBuild project to
|                                             execute get_baselines_and_configs.py
├── get_baselines_and_configs.py            # gets baselines/configs files and updates configs files
├── model-monitor-template.yml              # AWS CloudFormation template to deploy monitors
├── prod-monitoring-schedule-config.json    # Template parameters for prod environment
├── staging-monitoring-schedule-config.json # template parameters for staging environment
└── utils.py                                # helper functions used by get_baselines_and_configs.py
```
