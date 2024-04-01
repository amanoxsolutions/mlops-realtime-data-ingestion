import boto3
import os
import logging
import argparse
import json



# create clients
logger = logging.getLogger(__name__)
ssm_client = boto3.client("ssm")


def main():
    try:
        # define arguments
        parser = argparse.ArgumentParser("Get the arguments to store the parameters of the model build pipeline in SSM Parameter Store.")
        parser.add_argument(
            "--import-model-build-params-config",
            type=str,
            default="model-build-params.json",
            help=(
                "The JSON file's name containing various parameters of the model build pipeline."
                "Default 'model-build-params.json'."
            ),
        )
        # parse arguments
        args, _ = parser.parse_known_args()
        # Check that the configuration file exists
        if not os.path.exists(args.import_model_build_params_config):
            raise FileNotFoundError(f"The configuration file '{args.import_model_build_params_config}' does not exist.")
        # Read the JSON file storing the model validation thresholds
        with open(args.import_model_build_params_config, "r") as f:
            model_validation_thresholds = json.load(f)
        logger.info(f"Model validation threshold: {model_validation_thresholds}")
        # Store the model build configuration parameters in AWS Systems Manager Parameter Store
        for topic, parameters in model_validation_thresholds.items():
            for parameter, value in parameters.items():
                try:
                    ssm_client.put_parameter(
                        Name=f"/rdi-mlops/sagemaker/model-build/{topic}/{parameter}",
                        Description=f"Model build pipeline parameter for {topic}/{parameter}",
                        Value=str(value),
                        Type="String",
                        Overwrite=False,
                    )
                    logger.info(f"Stored model build parameter for {topic}/{parameter} in AWS Systems Manager Parameter Store.")
                except ssm_client.exceptions.ParameterAlreadyExists:
                    logger.info(f"Parameter {parameter} already exists in AWS Systems Manager Parameter Store.")
    except Exception as e:
        logger.error(f"An error occurred: {e}")
        raise e
    
if __name__ == "__main__":
    main()
