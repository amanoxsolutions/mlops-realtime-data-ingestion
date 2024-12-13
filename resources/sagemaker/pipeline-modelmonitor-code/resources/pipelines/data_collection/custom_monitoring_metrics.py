import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "sagemaker>=2.197.0"])
subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas>=2.1.3"])
from utils import (  # noqa: E402
    DeepARPredictor,
    get_session,
    write_dicts_to_file,
    get_ssm_parameters,
)
import json  # noqa: E402
import os  # noqa: E402
import argparse  # noqa: E402
import boto3  # noqa: E402
import logging  # noqa: E402
from botocore.config import Config  # noqa: E402
from sagemaker import Session  # noqa: E402
import pandas as pd  # noqa: E402
from sagemaker.feature_store.feature_group import FeatureGroup  # noqa: E402

# create clients
AWS_REGION = os.environ["AWS_REGION"]
STAGE_NAME = os.environ["STAGE_NAME"]
logger = logging.getLogger(__name__)
boto3_config = Config(
    region_name=AWS_REGION,
)
ssm_client = boto3.client("ssm", config=boto3_config)
s3_client = boto3.resource("s3", config=boto3_config)
cw_client = boto3.client("cloudwatch", config=boto3_config)


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
        ts=ts, quantiles=[0.1, 0.5, 0.9], return_mean=True
    )

    # Create a dataframe with the target_col from the test targets and the quantiles from the Batch Transform outputs
    df_aggregate = pd.DataFrame(
        {
            "target": df_target_data[target_col],
            "mean": df_predictions["mean"],
            "quantile1": df_predictions["0.1"],
            "quantile5": df_predictions["0.5"],
            "quantile9": df_predictions["0.9"],
        }
    )

    # Compute the RMSE for the middle quantile
    logger.info("Computing the RMSE for the middle quantile.")
    df_aggregate["error"] = df_aggregate["target"] - df_aggregate["mean"]
    df_aggregate["error"] = df_aggregate["error"].pow(2)
    rmse = df_aggregate["error"].mean() ** 0.5
    # Compute the mean weighted quantile loss for a specific quantile
    # The weighted quantile loss is :
    # 2 * Sum of Q(quantile) / sum(abs(target))
    # Where Q(quantile) is
    # if quantile value > prediction : (1-quantile) * abs(target - prediction)
    # else : quantile * abs(target - prediction)
    # Then we take the mean of the weighted quantile loss for all the predictions
    logger.info("Computing the mean weighted quantile loss.")
    weighted_quantile_loss = []
    for q in [1, 5, 9]:
        df_aggregate[f"quantile_loss_{q}"] = 0.0
        df_aggregate.loc[
            df_aggregate[f"quantile{q}"] > df_aggregate["target"], f"quantile_loss_{q}"
        ] = (1 - (q / 10)) * abs(df_aggregate[f"quantile{q}"] - df_aggregate["target"])
        df_aggregate.loc[
            df_aggregate[f"quantile{q}"] <= df_aggregate["target"], f"quantile_loss_{q}"
        ] = q / 10 * abs(df_aggregate[f"quantile{q}"] - df_aggregate["target"])
        weighted_quantile_loss.append(
            2
            * df_aggregate[f"quantile_loss_{q}"].sum()
            / abs(df_aggregate["target"]).sum()
        )
    mean_weighted_quantile_loss = sum(weighted_quantile_loss) / len(
        weighted_quantile_loss
    )

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
    with open(f"{local_data_folder}/evaluation/evaluation.json", "w") as f:
        f.write(json.dumps(report_dict))
