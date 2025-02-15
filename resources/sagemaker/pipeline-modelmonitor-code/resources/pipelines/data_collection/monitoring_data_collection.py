import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "sagemaker>=2.197.0"])
subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas>=2.1.3"])
from utils import (
    DeepARPredictor,
    DeepARData,
    get_session,
    write_dicts_to_file,
    get_ssm_parameters,
)
from sagemaker.feature_store.feature_group import FeatureGroup
import json
import os
import argparse
from datetime import datetime, timezone
import uuid
import boto3
import logging
import time
from botocore.config import Config
from sagemaker import Session
import pandas as pd
from typing import List, Dict, Any, TypeAlias

# create clients
AWS_REGION = os.environ["AWS_REGION"]
logger = logging.getLogger(__name__)
boto3_config = Config(
    region_name=AWS_REGION,
)
ssm_client = boto3.client("ssm", config=boto3_config)
s3_client = boto3.resource("s3", config=boto3_config)

OutputData: TypeAlias = Dict[str, Any | "OutputData"]


def ground_truth_with_id(data: str, uuid: str) -> OutputData:
    return {
        "groundTruthData": {
            "data": str(data),
            "encoding": "CSV",
        },
        "eventMetadata": {
            "eventId": str(uuid),
        },
        "eventVersion": "0",
    }


def predictions_with_id(
    uuid: str, input_data: List[DeepARData], prediction: float
) -> OutputData:
    return {
        "captureData": {
            "endpointInput": {
                "observedContentType": "application/json",
                "mode": "INPUT",
                "data": f'{{"instances" : {input_data} }}',
                "encoding": "JSON",
            },
            "endpointOutput": {
                "observedContentType": "text/csv; charset=character-encoding",
                "mode": "OUTPUT",
                "data": str(prediction),
                "encoding": "CSV",
            },
        },
        "eventMetadata": {
            "eventId": str(uuid),
            "inferenceId": str(uuid),
            "inferenceTime": str(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        },
        "eventVersion": "0",
    }


def write_output_data(path: str, record: OutputData, file_index: int) -> None:
    json_record = [json.dumps(record)]
    data_to_upload = "\n".join(json_record)
    with open(f"{path}record_{file_index}.jsonl", "w") as f:
        f.write(data_to_upload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-data-folder", type=str, required=True)
    args = parser.parse_args()
    local_data_folder = args.local_data_folder
    # Read the SSM Paramters for the stack
    stack_parameters = get_ssm_parameters(ssm_client, "/rdi-mlops/stack-parameters")
    # Read the SSM Paramters for the model prediction target
    model_target_parameters = get_ssm_parameters(
        ssm_client, "/rdi-mlops/sagemaker/model-build/target"
    )

    # Set some Buckets variables
    model_artifacts_bucket = f"{stack_parameters['project-prefix']}-sagemaker-experiment-{stack_parameters['bucket-suffix']}"

    # Set session variables
    sagemaker_session = get_session(AWS_REGION, model_artifacts_bucket)
    boto_session = boto3.Session(region_name=AWS_REGION)

    # Set boto3 S3 client

    # Set feature store session
    sagemaker_client = boto_session.client(
        service_name="sagemaker", region_name=AWS_REGION
    )
    featurestore_runtime = boto_session.client(
        service_name="sagemaker-featurestore-runtime", region_name=AWS_REGION
    )
    feature_store_session = Session(
        boto_session=boto_session,
        sagemaker_client=sagemaker_client,
        sagemaker_featurestore_runtime_client=featurestore_runtime,
    )

    transactions_feature_group_name = stack_parameters["sagemaker-feature-group-name"]
    transactions_feature_group = FeatureGroup(
        name=transactions_feature_group_name, sagemaker_session=feature_store_session
    )
    transactions_data_query = transactions_feature_group.athena_query()
    transactions_data_table = transactions_data_query.table_name

    query_string = f'SELECT * FROM "{transactions_data_table}"'

    # run Athena query. The output is loaded to a Pandas dataframe.
    # dataset = pd.DataFrame()
    transactions_data_query.run(
        query_string=query_string,
        output_location="s3://" + model_artifacts_bucket + "/query_results/",
    )
    transactions_data_query.wait()
    df = transactions_data_query.as_dataframe()

    df.sort_values(by="tx_minute", axis=0, ascending=True, inplace=True)
    df["tx_minute"] = pd.to_datetime(df["tx_minute"])
    df.set_index("tx_minute", drop=True, inplace=True)

    start_dataset = df.index.min()
    target_col = model_target_parameters["target_col"]

    total_nb_data_points = len(df)
    prediction_length = int(model_target_parameters["prediction_length"])
    min_data_length = 2 * prediction_length

    if total_nb_data_points < min_data_length:
        prediction_length = int(total_nb_data_points * 0.05)

    df_input_data = df[:-prediction_length]
    df_target_data = df[-prediction_length:]

    input_data = [
        {
            "start": str(start_dataset),
            "target": list(df_input_data[target_col]),
        }
    ]

    target_data = [
        {
            "start": str(start_dataset),
            "target": list(df_target_data[target_col]),
        }
    ]

    for folder_name in ["input", "target"]:
        if not os.path.isdir(f"{local_data_folder}/{folder_name}"):
            os.makedirs(f"{local_data_folder}/{folder_name}", exist_ok=True)
    write_dicts_to_file(f"{local_data_folder}/target/target.jsonl", target_data)
    write_dicts_to_file(f"{local_data_folder}/input/input.jsonl", input_data)

    endpoint_name = f"{stack_parameters['sagemaker-project-name']}-staging"
    predictor = DeepARPredictor(
        endpoint_name=endpoint_name, sagemaker_session=sagemaker_session
    )

    # Convert the context data to time series
    ts = df_input_data[target_col]
    df_predictions = predictor.predict(ts=ts, quantiles=[0.1, 0.5, 0.9])

    # Set the predictions and ground-truth folders
    upload_time = datetime.utcnow()
    prediction_folder = f"{local_data_folder}/predictions/{upload_time:%Y/%m/%d/%H/}"
    ground_truth_folder = f"{local_data_folder}/ground-truth/{upload_time:%Y/%m/%d/%H/}"
    if not os.path.isdir(prediction_folder):
        os.makedirs(prediction_folder, exist_ok=True)
    if not os.path.isdir(ground_truth_folder):
        os.makedirs(ground_truth_folder, exist_ok=True)
    for i in range(prediction_length):
        record_uuid = uuid.uuid4()

        predictions_data = predictions_with_id(
            record_uuid, input_data, df_predictions["0.5"].values[i]
        )
        write_output_data(prediction_folder, predictions_data, i)

        target_value = list(df_input_data[target_col])[i]
        ground_truth = f"{i}?{target_value}"
        ground_truth_data = ground_truth_with_id(
            list(df_input_data[target_col])[i], record_uuid
        )
        write_output_data(ground_truth_folder, ground_truth_data, i)

        time.sleep(1)
