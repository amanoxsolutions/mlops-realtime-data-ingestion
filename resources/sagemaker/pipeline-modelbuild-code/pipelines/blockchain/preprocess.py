"""Feature engineers the Blockchain time series dataset for the DeepAR model."""

# install the sagemaker package before the import
import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "sagemaker>=2.239.0"])
subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas>=2.1.3"])
import json  # noqa: E402
import pathlib  # noqa: E402
import logging  # noqa: E402
import argparse  # noqa: E402
import boto3  # noqa: E402
import pandas as pd  # noqa: E402
from sagemaker.session import Session  # noqa: E402
from sagemaker.feature_store.feature_group import FeatureGroup  # noqa: E402

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.addHandler(logging.StreamHandler())


#
# Constants
#
# Directories
PROCESSING_FOLDER_NAME = "processing"
LOCAL_DATA_DIR = f"/opt/ml/{PROCESSING_FOLDER_NAME}/data"


def write_dicts_to_file(path, data):
    with open(path, "wb") as fp:
        for d in data:
            fp.write(json.dumps(d).encode("utf-8"))
            fp.write("\n".encode("utf-8"))


if __name__ == "__main__":
    logger.info("Starting preprocessing.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", type=str, required=True)
    parser.add_argument("--feature-group-name", type=str, required=True)
    parser.add_argument("--artifacts-bucket", type=str, required=True)
    parser.add_argument("--base-job-prefix", type=str, required=True)
    parser.add_argument("--freq", type=str, required=True)
    parser.add_argument("--target-col", type=str, required=True)
    parser.add_argument("--prediction-length", type=int, required=True)
    args = parser.parse_args()
    region = args.region
    feature_group_name = args.feature_group_name
    freq = args.freq
    target_col = args.target_col
    prediction_length = args.prediction_length
    # Set S3 Buckets variables
    artifacts_bucket = args.artifacts_bucket
    base_job_prefix = args.base_job_prefix

    # Set feature store session
    boto_session = boto3.Session(region_name=region)
    sagemaker_client = boto_session.client(service_name="sagemaker", region_name=region)
    featurestore_runtime = boto_session.client(
        service_name="sagemaker-featurestore-runtime", region_name=region
    )
    feature_store_session = Session(
        boto_session=boto_session,
        sagemaker_client=sagemaker_client,
        sagemaker_featurestore_runtime_client=featurestore_runtime,
    )

    # Load data from LeatureStore
    logger.info("Loading the data from SageMaker FeatureStore using Athena.")
    transactions_feature_group_name = feature_group_name
    transactions_feature_group = FeatureGroup(
        name=transactions_feature_group_name, sagemaker_session=feature_store_session
    )
    # Query the Data from FeatureStore using Athena
    transactions_data_query = transactions_feature_group.athena_query()
    transactions_data_table = transactions_data_query.table_name
    query_string = f'SELECT * FROM "{transactions_data_table}"'
    # run Athena query. The output is loaded to a Pandas dataframe.
    # dataset = pd.DataFrame()
    transactions_data_query.run(
        query_string=query_string,
        output_location="s3://"
        + artifacts_bucket
        + "/"
        + base_job_prefix
        + "/athena_query_results/",
    )
    transactions_data_query.wait()
    df = transactions_data_query.as_dataframe()

    # Simple Dataset ETL:
    # - sort the values by time
    # - convert the time column from string to Pandas TImestamp
    logger.info("Performing Simple ETL.")
    df.sort_values(by="tx_minute", axis=0, ascending=True, inplace=True)
    df["tx_minute"] = pd.to_datetime(df["tx_minute"])
    df.set_index("tx_minute", drop=True, inplace=True)

    # Create the Train, Test and Validation Splits
    logger.info(
        f"Splitting {len(df)} data points into train, validation, test datasets."
    )
    start_dataset = df.index.min()
    end_dataset = df.index.max()
    dataset_period = end_dataset - start_dataset
    num_validation_windows = 4
    total_nb_data_points = len(df)
    context_length = prediction_length
    test_length = prediction_length
    min_data_length = context_length + prediction_length * (num_validation_windows + 1)
    if total_nb_data_points < min_data_length:
        prediction_length = int(total_nb_data_points * 0.05)
        test_length = prediction_length
        context_length = total_nb_data_points - prediction_length * (
            num_validation_windows + 1
        )
    validation_windows_length = num_validation_windows * prediction_length

    # Format the datasets for DeepAR
    logger.info("Formatting the data for the DeepAR model.")
    df_test_targets = df[-test_length:]
    df_train_validation = df[:-test_length]
    df_train = df_train_validation[:-validation_windows_length]

    training_data = [
        {
            "start": str(start_dataset),
            "target": list(df_train[target_col]),
        }
    ]
    validation_data = [
        {
            "start": str(start_dataset),
            "target": list(
                df_train_validation.iloc[
                    0 : -int((num_validation_windows - k) * prediction_length),
                    df_train_validation.columns.get_loc(target_col),
                ]
            ),
        }
        for k in range(1, num_validation_windows)
    ]
    validation_data.append(
        {
            "start": str(start_dataset),
            "target": list(df_train_validation[target_col]),
        }
    )
    # For testing the dataset input will be the data minus the last prediction_length, which
    # is equal to the entire train and cvalidation dataset
    # The target will be the last prediction_length data points
    test_inputs_data = [
        {
            "start": str(start_dataset),
            "target": list(df_train_validation[target_col]),
        }
    ]

    # Store the datasets locally
    # (They will be stored to S3 in the pipeline using the ProcessingOutput)
    logger.info("Copying the training, validation and test datasets.")
    for data_path in ["train", "validation", "test"]:
        pathlib.Path(f"{LOCAL_DATA_DIR}/{data_path}").mkdir(parents=True, exist_ok=True)
    write_dicts_to_file(f"{LOCAL_DATA_DIR}/train/train.json", training_data)
    write_dicts_to_file(f"{LOCAL_DATA_DIR}/validation/validation.json", validation_data)
    write_dicts_to_file(f"{LOCAL_DATA_DIR}/test/test-inputs.json", test_inputs_data)
    df_test_targets.to_csv(
        f"{LOCAL_DATA_DIR}/test/test-targets.csv", header=True, index=False
    )
