def preprocess_handler(inference_record, logger):
    predicted_data = inference_record.endpoint_output.data
    ground_truth_data = inference_record.ground_truth.data
    logger.info(f"Predicted Data: {predicted_data}")
    logger.info(f"Ground Truth Data: {ground_truth_data}")
    output_data_dict = {
        "groundTruthData_0": ground_truth_data,
        "endpointOutput_target_value": predicted_data
    }
    logger.info(f"Monitoring Data: {output_data_dict}")
    return output_data_dict
