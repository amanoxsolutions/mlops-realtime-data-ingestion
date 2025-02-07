# This code is based on AWS sample code available at:
# https://github.com/aws-samples/amazon-managed-service-for-apache-flink-examples/blob/main/python/TumblingWindows/tumbling-windows.py
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# -*- coding: utf-8 -*-

"""
main.py
~~~~~~~~~~~~~~~~~~~
This module:
    1. Creates a table environment
    2. Creates a source table from a Kinesis Data Stream
    3. Creates a sink table writing to a Kinesis Data Stream
    4. Queries from the Source Table and
       creates a tumbling window over 10 seconds to calculate the cumulative price over the window.
    5. These tumbling window results are inserted into the Sink table.
"""

from pyflink.table import EnvironmentSettings, TableEnvironment, DataTypes
from pyflink.table.window import Tumble
from pyflink.table.expressions import col, lit
from pyflink.table.udf import udf
import os
import json

# 1. Creates a Table Environment
env_settings = EnvironmentSettings.in_streaming_mode()
table_env = TableEnvironment.create(environment_settings=env_settings)
# access flink configuration after table environment instantiation
table_config = table_env.get_config()
# set the Flink Watermaker IDLE strategy
# Documentation: https://nightlies.apache.org/flink/flink-docs-release-1.19/docs/dev/datastream/event-time/generating_watermarks/#dealing-with-idle-sources
# Article: https://medium.com/@ipolyzos_/understanding-watermarks-in-apache-flink-c8793a50fbb8
table_config.set("table.exec.source.idle-timeout", "20000")

APPLICATION_PROPERTIES_FILE_PATH = "/etc/flink/application_properties.json"


# Functions to read the application properties
def get_application_properties():
    if os.path.isfile(APPLICATION_PROPERTIES_FILE_PATH):
        with open(APPLICATION_PROPERTIES_FILE_PATH, "r") as file:
            contents = file.read()
            properties = json.loads(contents)
            return properties
    else:
        print('A file at "{}" was not found'.format(APPLICATION_PROPERTIES_FILE_PATH))


def property_map(props, property_group_id):
    for prop in props:
        if prop["PropertyGroupId"] == property_group_id:
            return prop["PropertyMap"]


# Functions to create the input and out tables and the tumbling window aggregation
def create_input_table(table_name, stream_name, region, initpos):
    return """CREATE TABLE {0} (
                hash VARCHAR(64) NOT NULL,
                ver INTEGER,
                vin_sz INTEGER,
                vout_sz INTEGER,
                size INTEGER,
                weight INTEGER,
                fee INTEGER,
                relayed_by VARCHAR(8),
                lock_time INTEGER,
                tx_index BIGINT,
                double_spend BOOLEAN,
                `time` BIGINT,
                tx_time AS TO_TIMESTAMP(FROM_UNIXTIME(`time`)),
                block_index BIGINT,
                block_height BIGINT,
                inputs STRING,
                `out` STRING,
                rbf BOOLEAN,
                WATERMARK FOR tx_time AS tx_time - INTERVAL '60' SECOND
              )
              WITH (
                'connector' = 'kinesis',
                'stream' = '{1}',
                'aws.region' = '{2}',
                'scan.stream.initpos' = '{3}',
                'format' = 'json',
                'json.timestamp-format.standard' = 'ISO-8601'
              ) """.format(table_name, stream_name, region, initpos)


def create_output_table(table_name, stream_name, region):
    return """CREATE TABLE {0} (
                tx_minute VARCHAR(64),
                total_nb_trx_1min BIGINT,
                total_fee_1min BIGINT,
                avg_fee_1min FLOAT
              )
              WITH (
                'connector' = 'kinesis',
                'stream' = '{1}',
                'aws.region' = '{2}',
                'format' = 'json',
                'json.timestamp-format.standard' = 'ISO-8601'
              ) """.format(table_name, stream_name, region)


def perform_tumbling_window_aggregation(input_table_name):
    # use SQL Table in the Table API
    input_table = table_env.from_path(input_table_name)
    tumbling_window_table = (
        input_table.window(
            Tumble.over(lit(1).minute).on(col("tx_time")).alias("tx_minute")
        )
        .group_by(col("tx_minute"))
        .select(
            (to_string(col("tx_minute").start)).alias("tx_minute"),
            col("hash").count.alias("total_nb_trx_1min"),
            col("fee").sum.alias("total_fee_1min"),
            col("fee").avg.alias("avg_fee_1min"),
        )
    )
    return tumbling_window_table


# Create a User Defined Function to convert TIMESTAMP to STRING
@udf(input_types=[DataTypes.TIMESTAMP(3)], result_type=DataTypes.STRING())
def to_string(i):
    return str(i)


table_env.create_temporary_system_function("to_string", to_string)


def main():
    # Application Property Keys
    INPUT_PROPERTY_GROUP_KEY = "consumer.config.0"
    PRODUCER_PROPERTY_GROUP_KEY = "producer.config.0"

    INPUT_STREAM_KEY = "input.stream.name"
    INPUT_REGION_KEY = "aws.region"
    INPUT_STARTING_POSITION_KEY = "scan.stream.initpos"

    OUTPUT_STREAM_KEY = "output.stream.name"
    OUTPUT_REGION_KEY = "aws.region"

    # tables
    INPUT_TABLE_NAME = "input_table"
    OUTPUT_TABLE_NAME = "output_table"

    # get application properties
    props = get_application_properties()

    input_property_map = property_map(props, INPUT_PROPERTY_GROUP_KEY)
    output_property_map = property_map(props, PRODUCER_PROPERTY_GROUP_KEY)

    input_stream = input_property_map[INPUT_STREAM_KEY]
    input_region = input_property_map[INPUT_REGION_KEY]
    stream_initpos = input_property_map[INPUT_STARTING_POSITION_KEY]

    output_stream = output_property_map[OUTPUT_STREAM_KEY]
    output_region = output_property_map[OUTPUT_REGION_KEY]

    # 2. Creates a source table from a Kinesis Data Stream
    table_env.execute_sql(
        create_input_table(INPUT_TABLE_NAME, input_stream, input_region, stream_initpos)
    )

    # 3. Creates a sink table writing to a Kinesis Data Stream
    table_env.execute_sql(
        create_output_table(OUTPUT_TABLE_NAME, output_stream, output_region)
    )

    # 4. Queries from the Source Table and creates a tumbling window over 1 minute to calculate the
    # aggregated metrics over the window.
    tumbling_window_table = perform_tumbling_window_aggregation(INPUT_TABLE_NAME)
    table_env.create_temporary_view("tumbling_window_table", tumbling_window_table)

    # 5. These tumbling windows are inserted into the sink table
    table_env.execute_sql(
        "INSERT INTO {0} SELECT * FROM {1}".format(
            OUTPUT_TABLE_NAME, "tumbling_window_table"
        )
    )


if __name__ == "__main__":
    main()
