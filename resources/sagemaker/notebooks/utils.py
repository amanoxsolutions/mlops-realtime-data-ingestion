import json
import sagemaker
import botocore
import pandas as pd
import numpy as np
from sagemaker.serializers import IdentitySerializer
from typing import Dict


class DeepARPredictor(sagemaker.predictor.Predictor):
    def __init__(self, *args, **kwargs):
        super().__init__(
            *args,
            # serializer=JSONSerializer(),
            serializer=IdentitySerializer(content_type="application/json"),
            **kwargs,
        )

    def predict(
        self,
        ts,
        freq=pd.Timedelta(1, "min"),
        cat=None,
        dynamic_feat=None,
        num_samples=100,
        return_samples=False,
        return_mean=False,
        quantiles=["0.1", "0.5", "0.9"],
    ):
        """Requests the prediction of for the time series listed in `ts`, each with the (optional)
        corresponding category listed in `cat`.

        ts -- `pandas.Series` object, the time series to predict
        cat -- integer, the group associated to the time series (default: None)
        num_samples -- integer, number of samples to compute at prediction time (default: 100)
        return_samples -- boolean indicating whether to include samples in the response (default: False)
        quantiles -- list of strings specifying the quantiles to compute (default: ["0.1", "0.5", "0.9"])

        Return value: list of `pandas.DataFrame` objects, each containing the predictions
        """
        prediction_time = ts.index[-1] + freq
        quantiles = [str(q) for q in quantiles]
        req = self.__encode_request(
            ts, cat, dynamic_feat, num_samples, return_samples, return_mean, quantiles
        )
        res = super(DeepARPredictor, self).predict(req)
        return self.__decode_response(
            res, freq, prediction_time, return_samples, return_mean
        )

    def __encode_request(
        self, ts, cat, dynamic_feat, num_samples, return_samples, return_mean, quantiles
    ):
        instance = series_to_dict(
            ts, cat if cat is not None else None, dynamic_feat if dynamic_feat else None
        )
        output_types = ["quantiles"]
        if return_samples:
            output_types.append("samples")
        if return_mean:
            output_types.append("mean")

        configuration = {
            "num_samples": num_samples,
            "output_types": output_types,
            "quantiles": quantiles,
        }

        http_request_data = {"instances": [instance], "configuration": configuration}

        return json.dumps(http_request_data).encode("utf-8")

    def __decode_response(
        self, response, freq, prediction_time, return_samples, return_mean
    ):
        # we only sent one time series so we only receive one in return
        # however, if possible one will pass multiple time series as predictions will then be faster
        predictions = json.loads(response.decode("utf-8"))["predictions"][0]
        prediction_length = len(next(iter(predictions["quantiles"].values())))
        prediction_index = pd.date_range(
            start=prediction_time, freq=freq, periods=prediction_length
        )
        if return_samples:
            dict_of_samples = {
                "sample_" + str(i): s for i, s in enumerate(predictions["samples"])
            }
        else:
            dict_of_samples = {}
        if return_mean:
            dict_of_mean = {"mean": predictions["mean"]}
        else:
            dict_of_mean = {}
        return pd.DataFrame(
            data={**predictions["quantiles"], **dict_of_samples, **dict_of_mean},
            index=prediction_index,
        )

    def set_frequency(self, freq):
        self.freq = freq


def encode_target(ts):
    return [x if np.isfinite(x) else "NaN" for x in ts]


def series_to_dict(ts, cat=None, dynamic_feat=None):
    """Given a pandas.Series object, returns a dictionary encoding the time series.

    ts -- a pands.Series object with the target time series
    cat -- an integer indicating the time series category

    Return value: a dictionary
    """
    obj = {"start": str(ts.index[0]), "target": encode_target(ts)}
    if cat is not None:
        obj["cat"] = cat
    if dynamic_feat is not None:
        obj["dynamic_feat"] = dynamic_feat
    return obj


def get_ssm_parameters(ssm_client: botocore.client, param_path: str) -> Dict[str, str]:
    """Retrieves the SSM parameters from the specified path

    Args:
        ssm_client (botocore.client): The SSM client
        param_path (str): The path to the SSM parameters

    Returns:
        Dict[str, str]: The SSM parameters
    """
    parameters = {}
    try:
        response = ssm_client.get_parameters_by_path(
            Path=param_path, Recursive=False, WithDecryption=False
        )
        for param in response["Parameters"]:
            parameters[param["Name"].split("/")[-1]] = param["Value"]
        while next_token := response.get("NextToken"):
            response = ssm_client.get_parameters_by_path(
                Path=param_path,
                Recursive=False,
                WithDecryption=False,
                NextToken=next_token,
            )
            for param in response["Parameters"]:
                parameters[param["Name"].split("/")[-1]] = param["Value"]
    except Exception as e:
        print(f"An error occurred reading the SSM stack parameters: {e}")
    return parameters
