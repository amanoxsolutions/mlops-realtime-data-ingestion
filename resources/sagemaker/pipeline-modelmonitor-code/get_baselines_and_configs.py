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
import os
import boto3
import argparse
import logging
import json
import sagemaker
import zipfile
from string import Template
from datetime import datetime

from utils import (
    exception_handler,
    read_config_from_json,
    get_baselines_and_model_name,
    process_bias_baselines,
    process_explainability_config_file,
    get_built_in_model_monitor_image_uri,
    extend_config,
    write_config_to_json,
)

# create clients
logger = logging.getLogger(__name__)
sm_client = boto3.client("sagemaker")
s3_client = boto3.client("s3")
ssm_client = boto3.client("ssm")
sts = boto3.client('sts')
AWS_ACCOUNT_ID = sts.get_caller_identity()["Account"]
REGION = boto3.session.Session().region_name

@exception_handler
def main():
    # define arguments
    parser = argparse.ArgumentParser("Get the arguments to create the data baseline job.")
    parser.add_argument(
        "--log-level",
        type=str,
        default=os.environ.get("LOGLEVEL", "INFO").upper(),
        help="Log level. One of ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG', 'NOTSET']. Default 'INFO'.",
    )
    parser.add_argument(
        "--model-monitor-role",
        type=str,
        required=True,
        help="The AWS IAM execution role's arn used by the model monitor.",
    )
    parser.add_argument("--sagemaker-project-id", type=str, required=True, help="The AWS SageMaker project's id.")
    parser.add_argument("--sagemaker-project-name", type=str, required=True, help="The AWS SageMaker project's name.")
    parser.add_argument(
        "--monitor-outputs-bucket",
        type=str,
        required=True,
        help=(
            "Amazon S3 bucket that will be used to store the outputs of the "
            "SageMaker Model Monitor's Baseline and monitoring schedule jobs."
        ),
    )
    parser.add_argument(
        "--import-staging-config",
        type=str,
        default="staging-monitoring-schedule-config.json",
        help=(
            "The JSON file's name containing the monitoring schedule's staging configuration."
            "Default 'staging-monitoring-schedule-config.json'."
        ),
    )
    parser.add_argument(
        "--import-prod-config",
        type=str,
        default="prod-monitoring-schedule-config.json",
        help=(
            "The JSON file's name containing the monitoring schedule's prod configuration."
            "Default 'prod-monitoring-schedule-config.json'."
        ),
    )
    parser.add_argument(
        "--export-staging-config",
        type=str,
        default="staging-monitoring-schedule-config-export.json",
        help=(
            "The JSON file's name used to export the monitoring schedule's staging configuration."
            "Default 'staging-monitoring-schedule-config-export.json'."
        ),
    )
    parser.add_argument(
        "--export-prod-config",
        type=str,
        default="prod-monitoring-schedule-config-export.json",
        help=(
            "The JSON file's name used to export the monitoring schedule's prod configuration."
            "Default 'prod-monitoring-schedule-config-export.json'."
        ),
    )
    parser.add_argument(
        "--export-staging-pipeline-config",
        type=str,
        default="pipeline-definition-staging.json",
        help=(
            "The JSON file's name used to export the monitoring data collection pipeline configuration."
            "Default 'pipeline-definition-staging.json'."
        ),
    )
    parser.add_argument(
        "--export-prod-pipeline-config",
        type=str,
        default="pipeline-definition-prod.json",
        help=(
            "The JSON file's name used to export the monitoring data collection pipeline configuration."
            "Default 'pipeline-definition-prod.json'."
        ),
    )

    # parse arguments
    args, _ = parser.parse_known_args()

    timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    
    project_prefix = ssm_client.get_parameter(
        Name="/rdi-mlops/stack-parameters/project-prefix"
    )["Parameter"]["Value"]
    mean_quantile_loss_threshold = ssm_client.get_parameter(
        Name="/rdi-mlops/sagemaker/model-build/validation-threshold/mean_quantile_loss"
    )["Parameter"]["Value"]
    # Configure logging to output the line number and message
    log_format = "%(levelname)s: [%(filename)s:%(lineno)s] %(message)s"
    logging.basicConfig(format=log_format, level=args.log_level)

    # get the name of the S3 bucket used to store the outputs of the Model Monitor's
    monitor_outputs_bucket = args.monitor_outputs_bucket

    # use the endpoint name, deployed in staging env., to get baselines (from MR) and model name
    staging_config = read_config_from_json(args.import_staging_config)
    endpoint_name = f"{args.sagemaker_project_name}-{staging_config['Parameters']['StageName']}"
    baselines = get_baselines_and_model_name(endpoint_name, sm_client)
    logger.info("Baselines returned from MR, and Model Name...")
    logger.info(baselines)

    # update Bias and Explainability baselines
    updated_baselines = {
        "ModelQuality": baselines["DriftCheckBaselines"]["ModelQuality"],
    }
    logger.info("Updated Baselines...")
    logger.info(updated_baselines)

    # get the ImageUri for model monitor and clarify
    monitor_image_uri = get_built_in_model_monitor_image_uri(
        region=REGION, framework="model-monitor"
    )
    clarify_image_uri = get_built_in_model_monitor_image_uri(
        region=REGION, framework="clarify"
    )

    # extend monitoring schedule configs
    logger.info("Update Monitoring Schedule configs for staging/prod...")
    staging_monitoring_pipeline_config_key = f"code-artifacts/monitoring-data-collection/{timestamp}/{args.export_staging_pipeline_config}"
    prod_monitoring_pipeline_config_key = f"code-artifacts/monitoring-data-collection/{timestamp}/{args.export_prod_pipeline_config}"
    staging_monitor_config = extend_config(
        args, 
        monitor_image_uri, 
        clarify_image_uri, 
        updated_baselines, 
        monitor_outputs_bucket, 
        staging_config, 
        sm_client, 
        project_prefix,
        staging_monitoring_pipeline_config_key,
        timestamp,
        mean_quantile_loss_threshold
    )
    prod_monitor_config = extend_config(
        args,
        monitor_image_uri,
        clarify_image_uri,
        updated_baselines,
        monitor_outputs_bucket,
        read_config_from_json(args.import_prod_config),
        sm_client,
        project_prefix,
        prod_monitoring_pipeline_config_key,
        timestamp,
        mean_quantile_loss_threshold
    )

    # export monitor configs
    logger.info("Export Monitoring Schedule configs for staging/prod...")
    write_config_to_json(args.export_staging_config, staging_monitor_config)
    write_config_to_json(args.export_prod_config, prod_monitor_config)

    # create monitoring pipeline configuration from the JSON template file
    # Copy script files to S3
    #s3_client.upload_file(
    #    "resources/pipelines/data_collection/preprocessor.py",
    #    monitor_outputs_bucket,
    #    f"code-artifacts/monitoring-data-collection/{timestamp}/preprocessor.py"
    #)
    s3_client.upload_file(
        "resources/pipelines/data_collection/monitoring_data_collection.py", 
        monitor_outputs_bucket, 
        f"code-artifacts/monitoring-data-collection/{timestamp}/monitoring_data_collection.py"
    )
    s3_client.upload_file(
        "resources/pipelines/data_collection/custom_monitoring_metrics.py", 
        monitor_outputs_bucket, 
        f"code-artifacts/monitoring-data-collection/{timestamp}/custom_monitoring_metrics.py"
    )
    s3_client.upload_file(
        "resources/pipelines/data_collection/utils.py", 
        monitor_outputs_bucket, 
        f"code-artifacts/monitoring-data-collection/{timestamp}/utils.py"
    )   
    # List of processing images: https://github.com/aws/sagemaker-python-sdk/tree/master/src/sagemaker/image_uri_config
    # If we need to create our own container: https://docs.aws.amazon.com/sagemaker/latest/dg/processing-container-run-scripts.html
    processing_image_uri = sagemaker.image_uris.get_base_python_image_uri(
        region=REGION, 
        py_version="310"
    )
    # Create the monitoring pipeline configuration for staging
    staging_monitoring_pipeline_data = dict(
        region = REGION,
        project_id = args.sagemaker_project_id,
        sagemaker_project_name = args.sagemaker_project_name,
        stage_name = staging_config['Parameters']['StageName'],
        pipeline_name = f"{project_prefix}-{staging_config['Parameters']['StageName']}-monitoring-data-collection",
        execution_role_arn = f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/service-role/AmazonSageMakerServiceCatalogProductsUseRole",
        processing_image_uri = processing_image_uri,
        timestamp = timestamp
    )
    with open("resources/pipelines/data_collection/monitoring-pipeline-definition-template.json", "r") as template_file:
        template = Template(template_file.read())
        monitoring_pipeline_config = json.loads(template.substitute(staging_monitoring_pipeline_data))
        logger.info("Monitoring Pipeline Configuration...")
        logger.info(monitoring_pipeline_config)
        write_config_to_json(args.export_staging_pipeline_config, monitoring_pipeline_config)
        s3_client.upload_file(args.export_staging_pipeline_config, monitor_outputs_bucket, staging_monitoring_pipeline_config_key)
    # Create the monitoring pipeline configuration for prod
    prod_config = read_config_from_json(args.import_prod_config)
    prod_monitoring_pipeline_data = dict(
        region = REGION,
        project_id = args.sagemaker_project_id,
        sagemaker_project_name = args.sagemaker_project_name,
        stage_name = prod_config['Parameters']['StageName'],
        pipeline_name = f"{project_prefix}-{prod_config['Parameters']['StageName']}-monitoring-data-collection",
        execution_role_arn = f"arn:aws:iam::{AWS_ACCOUNT_ID}:role/service-role/AmazonSageMakerServiceCatalogProductsUseRole",
        processing_image_uri = processing_image_uri,
        timestamp = timestamp
    )
    with open("resources/pipelines/data_collection/monitoring-pipeline-definition-template.json", "r") as template_file:
        template = Template(template_file.read())
        monitoring_pipeline_config = json.loads(template.substitute(prod_monitoring_pipeline_data))
        logger.info("Monitoring Pipeline Configuration...")
        logger.info(monitoring_pipeline_config)
        write_config_to_json(args.export_prod_pipeline_config, monitoring_pipeline_config)
        s3_client.upload_file(args.export_prod_pipeline_config, monitor_outputs_bucket, prod_monitoring_pipeline_config_key)
    
    # Crete a ZIP file of the Lambda Python code stored in the resources\lambdas\trigger_model_build directory
    with zipfile.ZipFile("resources/lambdas/trigger_model_build/trigger_model_build.zip", "w") as zipf:
        zipf.write("resources/lambdas/trigger_model_build/main.py", "main.py")
    # Upload the ZIP file to the S3 bucket
    s3_client.upload_file(
        "resources/lambdas/trigger_model_build/trigger_model_build.zip",
        monitor_outputs_bucket,
        f"code-artifacts/monitoring-data-collection/{timestamp}/trigger_model_build.zip"
    )


if __name__ == "__main__":
    main()


