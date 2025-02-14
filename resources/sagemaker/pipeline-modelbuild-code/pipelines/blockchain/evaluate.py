"""Process the Batch Transform Outputs with the target data to have a single CSV file
with the following format: target, quantile0.1, quantile0.5, quantile0.9"""

import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas>=2.1.3"])
import json
import pathlib
import logging
import argparse
import pandas as pd
import numpy as np

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.addHandler(logging.StreamHandler())


#
# Constants
#
# Directories
LOCAL_DATA_DIR = "/opt/ml/processing/data"
TEST_DATA_PATH = f"{LOCAL_DATA_DIR}/test"
TRANSFORM_DATA_PATH = f"{LOCAL_DATA_DIR}/transform"
EVALUATION_DATA_PATH = f"{LOCAL_DATA_DIR}/evaluation"


# See https://website-nine-gules.vercel.app/blog/how-to-evaluate-probabilistic-forecasts-weighted-quantile-loss
# for weightd quantile losss calculations
def quantile_loss(alpha, q, x):
    return np.where(x > q, alpha * (x - q), (1 - alpha) * (q - x))


if __name__ == "__main__":
    logger.info("Starting processing of Batch Transforms outputs.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-col", type=str, required=True)
    args = parser.parse_args()
    # Set Data files variables
    target_col = args.target_col
    transform_outputs_file = f"{TRANSFORM_DATA_PATH}/test-inputs.json.out"
    test_targets_file = f"{TEST_DATA_PATH}/test-targets.csv"

    # Load the test targets CSV
    logger.info("Loading the test targets.")
    df_test_targets = pd.read_csv(test_targets_file, header=0)

    # Load the Batch Transform JSON outputs from S3.
    # In our case there should be only one line to read
    logger.info("Loading the Batch Transform outputs.")
    f = open(transform_outputs_file, "r")
    transform_outputs = json.load(f)

    # Create a dataframe with the target_col from the test targets and the quantiles from the Batch Transform outputs
    logger.info("Creating the final dataframe.")
    df_aggregate = pd.DataFrame(
        {
            "target": df_test_targets[target_col],
            "prediction_mean": transform_outputs["mean"],
            "prediction_0.1": transform_outputs["quantiles"]["0.1"],
            "prediction_0.5": transform_outputs["quantiles"]["0.5"],
            "prediction_0.9": transform_outputs["quantiles"]["0.9"],
        }
    )

    # Compute the RMSE for the mean
    logger.info("Computing the RMSE for the mean prediction.")
    df_aggregate["error"] = df_aggregate["target"] - df_aggregate["prediction_mean"]
    df_aggregate["error"] = df_aggregate["error"].pow(2)
    rmse = df_aggregate["error"].mean() ** 0.5
    # Compute the mean weighted quantile loss for a specific quantile
    # The weighted quantile loss is :
    # 2 / sum(abs(target))
    # Where Q(quantile) is
    # if quantile value > prediction : (1-quantile) * abs(target - prediction)
    # else : quantile * abs(target - prediction)
    # Then we take the mean of the weighted quantile loss for all the predictions
    # See https://website-nine-gules.vercel.app/blog/how-to-evaluate-probabilistic-forecasts-weighted-quantile-loss
    logger.info("Computing the mean weighted quantile loss.")
    weighted_quantile_losses = []
    weight = 2/np.abs(df_aggregate["target"]).sum()
    for q in [0.1, 0.5, 0.9]:
        ql = quantile_loss(q, df_aggregate[f"prediction_{q}"], df_aggregate["target"])
        df_aggregate[f"quantile_loss_{q}"] = ql
        weighted_quantile_losses.append(np.sum(ql) * weight)
    mean_weighted_quantile_loss = np.mean(weighted_quantile_losses)

    report_dict = {
        "deepar_metrics": {
            "rmse": {"value": rmse, "standard_deviation": "NaN"},
            "weighted_quantile_loss": {
                "value": mean_weighted_quantile_loss,
                "standard_deviation": "NaN",
            },
        },
    }

    # Write the final dataframe to a CSV file (we keep only the target and the quantiles and mean)
    logger.info("Writing the output of the transform processing and evaluation.")
    pathlib.Path(EVALUATION_DATA_PATH).mkdir(parents=True, exist_ok=True)
    df_aggregate.to_csv(
        f"{EVALUATION_DATA_PATH}/targets-quantiles.csv", header=True, index=False
    )
    with open(f"{EVALUATION_DATA_PATH}/evaluation.json", "w") as f:
        f.write(json.dumps(report_dict))
