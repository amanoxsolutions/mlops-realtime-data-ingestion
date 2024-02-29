# #####################################################################################################################
#  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                                 #
#                                                                                                                     #
#  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance     #
#  with the License. A copy of the License is located at                                                              #
#                                                                                                                     #
#  http://www.apache.org/licenses/LICENSE-2.0                                                                         #
#                                                                                                                     #
#  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES  #
#  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions     #
#  and limitations under the License.                                                                                 #
# #####################################################################################################################
import json
import sagemaker
import botocore
import argparse
import logging
from typing import Callable, Any, Dict, List, Tuple

logger = logging.getLogger(__name__)


def exception_handler(func: Callable[..., Any]) -> Any:
    """
    Decorator function to handle exceptions

    Args:
        func (object): function to be decorated

    Returns:
        func's return value

    Raises:
        Exception thrown by the decorated function
    """

    def wrapper_function(*args, **kwargs):
        try:
            return func(*args, **kwargs)

        except Exception as e:
            logger.error(f"Error in {func.__name__}: {str(e)}")
            raise e

    return wrapper_function


@exception_handler
def get_built_in_model_monitor_image_uri(region: str, framework: str) -> str:
    """
    Get the Amazon SageMaker Model Monitor Docker Image URI for the region

    Args:
        region (str): The AWS region, where the pipeline is deployed
        framework (str): framework name (model-monitor|clarify for model monitors)

    Returns:
        str: The Model Monitor Docker Image URI
    """
    model_monitor_image_uri = sagemaker.image_uris.retrieve(
        framework=framework,
        region=region,
    )

    return model_monitor_image_uri


def get_project_arn(sm_client: botocore.client, sagemaker_project_name: str) -> str:
    """
    Get the Amazon SageMaker Project Arn for the Sagemaker Project Name

    Args:
        sm_client (Boto3 SageMaker client): Amazon SageMaker boto3 client
        sagemaker_project_name (str): Amazon SageMaker Project name

    Returns:
        str: Amazon SageMaker Project arn
    """
    try:
        response = sm_client.describe_project(
            ProjectName=sagemaker_project_name
        )
        return response["ProjectArn"]
    except:
        logger.error("Error getting project tags")
    return ""



def get_project_tags(sm_client: botocore.client, sagemaker_project_arn: str) -> List[Dict[str, str]]:
    """
    Combines Resource's tags with Amazon SageMaker Studio project's custom tags

    Args:
        sm_client (Boto3 SageMaker client): Amazon SageMaker boto3 client
        sagemaker_project_arn (str): Amazon SageMaker Studio project ARN

    Returns:
        list[dict[str, str]]: The Amazon SageMaker project tags in the format [{"Key":<key>, "Value":<value>}, ...]
    """
    # list the projects tags
    try:
        response = sm_client.list_tags(ResourceArn=sagemaker_project_arn)
        return response["Tags"]
    except:
        logger.error("Error getting project tags")
    return []


def combine_resource_tags(new_tags: Dict[str, str], project_tags_list: List[Dict[str, str]]) -> Dict[str, str]:
    """
    Combines Resource's tags with Amazon SageMaker Studio project's tags

    Args:
        new_tags (dict): New Resource Tags in the format {<key>:<value>, ...}
        project_tags_list: Amazon SageMaker project's tags in the format [{"Key":<key>, "Value":<value>}, ...]

    Returns:
        dict[str, str]: The combined tags in the format {<key>:<value>, ...}
    """
    try:
        # reformat project tags from [{"Key":<key>, "Value":<value>}, ...] to {<key>:<value>, ...}
        project_tags_dict = {key_value_dict["Key"]: key_value_dict["Value"] for key_value_dict in project_tags_list}

        # return combined tags
        return {**new_tags, **project_tags_dict}
    except:
        logger.error("Error getting resource tags")
    return {}


@exception_handler
def get_baselines_and_model_name(endpoint_name: str, sm_client: botocore.client) -> Dict[str, Any]:
    """
    Gets Baselines from Model Registry and Model Name from the deployed endpoint

    Args:
        endpoint_name (str): SageMaker Endpoint name to be monitored
        sm_client (Boto3 SageMaker client): Amazon SageMaker boto3 client

    Returns:
        dict[str, Any]: The baselines and Model Name {"DriftCheckBaselines": {...}, "ModelName": "..."}
    """
    # get the EndpointConfigName using the Endpoint Name
    endpoint_config_name = sm_client.describe_endpoint(EndpointName=endpoint_name)["EndpointConfigName"]

    # get the ModelName using EndpointConfigName
    model_name = sm_client.describe_endpoint_config(EndpointConfigName=endpoint_config_name)["ProductionVariants"][0][
        "ModelName"
    ]

    # get the ModelPackageName using ModelName
    model_package_name = sm_client.describe_model(ModelName=model_name)["Containers"][0]["ModelPackageName"]

    # get the baselines from Model Registry using ModelPackageName
    raw_baselines = sm_client.describe_model_package(ModelPackageName=model_package_name).get("DriftCheckBaselines", {})

    # re-format the baselines
    result = {key: {k: raw_baselines[key][k]["S3Uri"] for k in raw_baselines.get(key)} for key in raw_baselines}

    return {"DriftCheckBaselines": result, "ModelName": model_name}


@exception_handler
def get_json_file_from_s3(bucket_name: str, file_key: str, s3_client: botocore.client) -> Dict[str, Any]:
    """
    Gets JSON file's contents from S3 bucket

    Args:
        bucket_name (str): S3 bucket name
        file_key (str): json file s3 key
        s3_client (Boto3 S3 client): Amazon S3 boto3 client

    Returns:
        dict[str, Any]: file contents
    """
    config_file = json.loads(s3_client.get_object(Bucket=bucket_name, Key=file_key)["Body"].read().decode("utf-8"))
    return config_file


@exception_handler
def upload_json_to_s3(file_contents: Dict[str, Any], bucket_name: str, file_key: str, s3_client: botocore.client):
    """
    Uploads JSON file's contents to S3 bucket

    Args:
        file_contents (dict[str, Any]): contents of file
        bucket_name (str): S3 bucket name
        file_key (str): json file s3 key
        s3_client (Boto3 S3 client): Amazon S3 boto3 client
    """
    s3_client.put_object(Body=json.dumps(file_contents, indent=4), Bucket=bucket_name, Key=file_key)


@exception_handler
def get_bucket_name_and_file_key(file_s3_uri: str) -> Tuple[str, str]:
    """
    Gets S3 bucket name and file key from S3 URI

    Args:
        file_s3_uri (str): S3 file URI

    Returns:
        Tuple[str, str]: (bucket_name, file_key)
    """
    bucket_key_string = file_s3_uri.split("//")[1]
    return (bucket_key_string.split("/")[0], "/".join(bucket_key_string.split("/")[1:]))


@exception_handler
def process_bias_baselines(bias_baselines: Dict[str, str], s3_client: botocore.client) -> Dict[str, str]:
    """
    Combines Model Bias PreTrainingConstraints/PostTrainingConstraints json files and uploads
    the combined json file to the same S3 bucket

    Args:
        bias_baselines (Dict[str, str]): raw Model Bias baselines returned from Model Registry
        s3_client (Boto3 S3 client): Amazon S3 boto3 client

    Returns:
        Dict[str, str]: processed Model Bias baselines
    """
    # extract the bucket name and file key
    pre_s3_bucket_name, pre_training_s3_file_key = get_bucket_name_and_file_key(
        bias_baselines["PreTrainingConstraints"]
    )
    post_s3_bucket_name, post_training_s3_file_key = get_bucket_name_and_file_key(
        bias_baselines["PostTrainingConstraints"]
    )
    # get json contents for Bias Pre/Post TrainingConstraints files
    pre_training_json = get_json_file_from_s3(pre_s3_bucket_name, pre_training_s3_file_key, s3_client)
    post_training_json = get_json_file_from_s3(post_s3_bucket_name, post_training_s3_file_key, s3_client)
    # combine Bias Pre/Post TrainingConstraints files
    pre_training_json.update(post_training_json)
    # create combined constraints file key
    combined_file_key = f"{'/'.join(post_training_s3_file_key.split('/')[:-1])}/combined_bias_constraints.json"
    # upload combined constraints json file to s3 bucket
    upload_json_to_s3(pre_training_json, post_s3_bucket_name, combined_file_key, s3_client)

    # return the new Bias baselines
    return {
        "ConfigFile": bias_baselines["ConfigFile"],
        "Constraints": "".join(["s3://", post_s3_bucket_name, "/", combined_file_key]),
    }


@exception_handler
def process_explainability_config_file(
    explainability_baselines: Dict[str, str], model_name: str, s3_client: botocore.client
) -> Dict[str, str]:
    """
    Updates Model Explainability json ConfigFile with model name, and uploads
    it to the same S3 bucket

    Args:
        explainability_baselines (Dict[str, str]): raw Model Explainability baselines returned from Model Registry
        model_name (str): Amazon SageMaker model name
        s3_client (Boto3 S3 client): Amazon S3 boto3 client

    Returns:
        Dict[str, str]: processed Model Explainability baselines
    """
    # extract the bucket name and file key
    s3_bucket_name, config_s3_file_key = get_bucket_name_and_file_key(explainability_baselines["ConfigFile"])
    # get json contents for Explainability ConfigFile file
    config_file_json = get_json_file_from_s3(s3_bucket_name, config_s3_file_key, s3_client)
    # add model name to the predictor section
    config_file_json["predictor"].update({"model_name": model_name})
    # create the final file key
    monitor_config_file_key = f"{'/'.join(config_s3_file_key.split('/')[:-1])}/monitor_analysis_config.json"
    # upload final config json file to s3 bucket
    upload_json_to_s3(config_file_json, s3_bucket_name, monitor_config_file_key, s3_client)
    # return the new Explainability baselines
    return {
        "ConfigFile": "".join(["s3://", s3_bucket_name, "/", monitor_config_file_key]),
        "Constraints": explainability_baselines["Constraints"],
    }


@exception_handler
def extend_config(
    args: argparse.Namespace,
    monitor_image_uri: str,
    clarify_image_uri: str,
    baselines: Dict[str, Any],
    monitor_outputs_bucket: str,
    stage_config: Dict[str, Dict[str, str]],
    sm_client: botocore.client,
    project_prefix: str,
    monitoring_pipelinde_definition_object: str,
    timestamp: str,
    mean_quantile_loss_threshold: str
) -> Dict[str, Dict[str, str]]:
    """
    Extend the stage configuration of the Monitoring Schedule with additional parameters and tags based.

    Args:
        args (Namespace): The Namespace containing the parsed arguments (using argparse)
        monitor_image_uri (str): Model Monitor docker image uri
        clarify_image_uri (str): Clarify docker image uri
        baselines (dict[str, dict[str, str]]): dict containing the processed Model Registry Baselines
        monitor_outputs_bucket (str): The S3 bucket name used to store monitor outputs
        stage_config (dict[str, dict[str, str]]): The stage's template parameters
        sm_client (Boto3 SageMaker client): Amazon SageMaker boto3 client

    Returns:
        dict[str, dict[str, str]]: The final Monitoring Schedule's config containing Parameters and Tags
    """
    # Verify that config has parameters and tags sections
    if "Parameters" not in stage_config or "StageName" not in stage_config["Parameters"]:
        raise ValueError("Configuration file must include SageName parameter")
    if "Tags" not in stage_config:
        stage_config["Tags"] = {}

    # Create jobs names
    endpoint_name = f"{args.sagemaker_project_name}-{stage_config['Parameters']['StageName']}"
    monitoring_schedule_name = f"{endpoint_name}"

    # Create new params and tags
    new_params = {
        "ProjectPrefix": project_prefix,
        "SageMakerProjectName": args.sagemaker_project_name,
        "SageMakerProjectId": args.sagemaker_project_id,
        "ModelMonitorRoleArn": args.model_monitor_role,
        "MonitoringScheduleName": monitoring_schedule_name,
        "EndpointName": endpoint_name,
        # if customer provided baselines in the stage config file (seed code) use them. Otherwise, use the baselines from MR
        "DataQualityConstraintsS3Uri": stage_config["Parameters"].get(
            "DataQualityConstraintsS3Uri", baselines.get("ModelDataQuality", {}).get("Constraints", "Empty")
        ),
        "DataQualityStatisticsS3Uri": stage_config["Parameters"].get(
            "DataQualityStatisticsS3Uri", baselines.get("ModelDataQuality", {}).get("Statistics", "Empty")
        ),
        "ModelQualityConstraintsS3Uri": stage_config["Parameters"].get(
            "ModelQualityConstraintsS3Uri", baselines.get("ModelQuality", {}).get("Constraints", "Empty")
        ),
        "ModelBiasConstraintsS3Uri": stage_config["Parameters"].get(
            "ModelBiasConstraintsS3Uri", baselines.get("Bias", {}).get("Constraints", "Empty")
        ),
        "ModelBiasConfigS3Uri": stage_config["Parameters"].get(
            "ModelBiasConfigS3Uri", baselines.get("Bias", {}).get("ConfigFile", "Empty")
        ),
        "ModelExplainabilityConstraintsS3Uri": stage_config["Parameters"].get(
            "ModelExplainabilityConstraintsS3Uri",
            baselines.get("Explainability", {}).get("Constraints", "Empty"),
        ),
        "ModelExplainabilityConfigS3Uri": stage_config["Parameters"].get(
            "ModelExplainabilityConfigS3Uri", baselines.get("Explainability", {}).get("ConfigFile", "Empty")
        ),
        "GroundTruthInput": f"s3://{monitor_outputs_bucket}/ground-truth-{stage_config['Parameters']['StageName']}/{args.sagemaker_project_name}-{stage_config['Parameters']['StageName']}",
        "RecordPreprocessorSourceUri": f"s3://{monitor_outputs_bucket}/code-artifacts/monitoring-data-collection/{timestamp}/preprocessor.py",
        "ModelMonitorImageUri": monitor_image_uri,
        "ClarifyImageUri": clarify_image_uri,
        "DataQualityMonitoringOutputS3Uri": f"s3://{monitor_outputs_bucket}/monitor-output/data-quality",
        "ModelQualityMonitoringOutputS3Uri": f"s3://{monitor_outputs_bucket}/monitor-output/model-quality",
        "ModelBiasMonitoringOutputS3Uri": f"s3://{monitor_outputs_bucket}/monitor-output/model-bias",
        "ModelExplainabilityMonitoringOutputS3Uri": f"s3://{monitor_outputs_bucket}/monitor-output/model-explainability",
        "MonitoringPipelineDefinitionBucket": monitor_outputs_bucket,
        "MonitoringPipelineDefinitionKey": monitoring_pipelinde_definition_object,
        "ModelBuildTriggerLambdaCodeS3Bucket": monitor_outputs_bucket,
        "ModelBuildTriggerLambdaCodeS3Key": f"code-artifacts/monitoring-data-collection/{timestamp}/trigger_model_build.zip",
        "ModelQualityMeanQuantileLossThreshold": mean_quantile_loss_threshold
    }

    # create new tags
    new_tags = {
        "sagemaker:deployment-stage": stage_config["Parameters"]["StageName"],
        "sagemaker:project-id": args.sagemaker_project_id,
        "sagemaker:project-name": args.sagemaker_project_name,
    }

    sagemaker_project_arn = get_project_arn(sm_client, args.sagemaker_project_name)
    project_tags = get_project_tags(sm_client, sagemaker_project_arn)

    # combine tags
    combined_tags = combine_resource_tags(new_tags, project_tags)

    return {
        "Parameters": {**stage_config["Parameters"], **new_params},
        "Tags": {**stage_config.get("Tags", {}), **combined_tags},
    }


@exception_handler
def read_config_from_json(file_name: str) -> Dict[str, Dict[str, str]]:
    """
    Reads template parameters/tags from a JSON file

    Args:
        file_name (str): The config JSON file name

    Returns:
        dict[str, dict[str, str]]: The config content
    """
    with open(file_name, "r") as f:
        config = json.load(f)
    return config


@exception_handler
def write_config_to_json(file_name: str, export_config: Dict[str, Dict[str, str]]) -> None:
    """
    Writes template parameters/tags to a JSON file

    Args:
        file_name (str): The config JSON file name
        export_config (dict[str, dict[str, str]]): The config dict to write
    """
    with open(file_name, "w") as f:
        json.dump(export_config, f, indent=4)
