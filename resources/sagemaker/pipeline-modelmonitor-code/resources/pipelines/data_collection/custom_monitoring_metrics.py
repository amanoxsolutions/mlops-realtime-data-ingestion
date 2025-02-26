import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "sagemaker>=2.197.0"])
subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas>=2.1.3"])
from utils import (
    DeepARPredictor,
    get_session,
    write_dicts_to_file,
    get_ssm_parameters,
)
import json
import os
import argparse
import boto3
import logging
from botocore.config import Config
from sagemaker import Session
import numpy as np
import pandas as pd
from sagemaker.feature_store.feature_group import FeatureGroup

# create clients
AWS_REGION = os.environ["AWS_REGION"]
STAGE_NAME = os.environ["STAGE_NAME"]
logger = logging.getLogger(__name__)
logging.basicConfig(encoding='utf-8', level=logging.INFO)
boto3_config = Config(
    region_name=AWS_REGION,
)
ssm_client = boto3.client("ssm", config=boto3_config)
s3_client = boto3.resource("s3", config=boto3_config)
cw_client = boto3.client("cloudwatch", config=boto3_config)


# See https://website-nine-gules.vercel.app/blog/how-to-evaluate-probabilistic-forecasts-weighted-quantile-loss
# for weightd quantile losss calculations
def quantile_loss(alpha, q, x):
    return np.where(x > q, alpha * (x - q), (1 - alpha) * (q - x))


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
    # Read the SSM Parameters storing the model validation thresholds by the parameters path
    model_validation_thresholds = get_ssm_parameters(
        ssm_client, "/rdi-mlops/sagemaker/model-build/validation-threshold"
    )
# Get the model confidence from the validation-threshold parameter and
    # Make sure the confidence is above 50 and below 100 otherwise default to 90
    confidence = float(model_validation_thresholds["confidence"])
    if not 50 < confidence < 100:
        confidence = 90.0
    low_quantile = round(0.5 - confidence * 0.005, 3)
    up_quantile = round(confidence * 0.005 + 0.5, 3)

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

    endpoint_name = f"{stack_parameters['sagemaker-project-name']}-staging"
    predictor = DeepARPredictor(
        endpoint_name=endpoint_name, sagemaker_session=sagemaker_session
    )

    # Convert the context data to time series
    ts = df_input_data[target_col]
    df_predictions = predictor.predict(
        ts=ts, quantiles=[low_quantile, 0.5, up_quantile], return_mean=True
    )

    targets = np.array(df_target_data[target_col])
    mean_predictions = np.array(df_predictions["mean"])
    # Create a dataframe with the target_col from the test targets and the quantiles from the Batch Transform outputs
    logger.info("Creating the final dataframe.")
    df_aggregate = pd.DataFrame(
        {
            "target": targets,
            "prediction_mean": mean_predictions,
            f"prediction_{low_quantile}": df_predictions[str(low_quantile)],
            "prediction_0.5": df_predictions["0.5"],
            f"prediction_{up_quantile}": df_predictions[str(up_quantile)],
        }
    )

    # Compute the RMSE for the mean
    logger.info("Computing the RMSE for the mean predition.")
    
    rmse = np.sqrt(((mean_predictions-targets)**2).mean())
    # Compute the mean weighted quantile loss for a specific quantile
    # See https://docs.aws.amazon.com/sagemaker/latest/dg/deepar.html
    # And https://website-nine-gules.vercel.app/blog/how-to-evaluate-probabilistic-forecasts-weighted-quantile-loss
    logger.info("Computing the mean weighted quantile loss.")
    weighted_quantile_losses = np.array([])
    weight = 2/np.abs(targets).sum()
    for q in [low_quantile, 0.5, up_quantile]:
        quantile_predictions = np.array(df_predictions[str(q)])
        ql = quantile_loss(q, quantile_predictions, targets)
        df_aggregate[f"quantile_loss_{q}"] = ql
        weighted_quantile_losses = np.append(weighted_quantile_losses, ql.sum() * weight)
    mean_weighted_quantile_loss = weighted_quantile_losses.mean()

    report_dict = {
        "deepar_metrics": {
            "rmse": {"value": rmse, "standard_deviation": "NaN"},
            "weighted_quantile_loss": {
                "value": mean_weighted_quantile_loss,
                "standard_deviation": "NaN",
            },
        },
    }

    # Create a CloudWatch metric with the mean weighted quantile loss values
    logger.info("Adding CloudWatch metric data")
    logger.info({
                "MetricName": "weighted_quantile_loss",
                "Dimensions": [{"Name": "StageName", "Value": STAGE_NAME}],
                "Unit": "None",
                "Value": mean_weighted_quantile_loss,
            })
    cw_client.put_metric_data(
        MetricData=[
            {
                "MetricName": "weighted_quantile_loss",
                "Dimensions": [{"Name": "StageName", "Value": STAGE_NAME}],
                "Unit": "None",
                "Value": mean_weighted_quantile_loss,
            },
        ],
        Namespace="CustomModelMonitoring",
    )
    cw_client.put_metric_data(
        MetricData=[
            {
                "MetricName": "weighted_quantile_loss_threshold",
                "Dimensions": [{"Name": "StageName", "Value": STAGE_NAME}],
                "Unit": "None",
                "Value": float(model_validation_thresholds["weighted_quantile_loss"]),
            },
        ],
        Namespace="CustomModelMonitoring",
    )

    # Write files
    for folder_name in ["input", "target", "predictions", "evaluation"]:
        if not os.path.isdir(f"{local_data_folder}/{folder_name}"):
            os.makedirs(f"{local_data_folder}/{folder_name}", exist_ok=True)
    write_dicts_to_file(f"{local_data_folder}/input/input.jsonl", input_data)
    df_target_data.to_csv(
        f"{local_data_folder}/target/target.csv", header=True, index=False
    )
    df_predictions.to_csv(
        f"{local_data_folder}/predictions/predictions.csv", header=True, index=False
    )
    df_aggregate.to_csv(
        f"{local_data_folder}/evaluation/target-quantiles-losses.csv", header=True, index=False
    )
    with open(f"{local_data_folder}/evaluation/evaluation.json", "w") as f:
        f.write(json.dumps(report_dict))
