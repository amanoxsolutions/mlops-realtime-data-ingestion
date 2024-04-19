from pyflink.table import EnvironmentSettings, StreamTableEnvironment, StatementSet
import os
import json

env_settings = EnvironmentSettings.new_instance().in_streaming_mode().use_blink_planner().build()
table_env = StreamTableEnvironment.create(environment_settings=env_settings)
statement_set = table_env.create_statement_set()


def create_table_input(table_name, stream_name, region, initpos):
    return """CREATE TABLE {0} (
                `version` INTEGER,
                `id` VARCHAR(64),
                `detail-type` VARCHAR(16),
                `source` VARCHAR(32),	
                `account` BIGINT,
                `time` TIMESTAMP(3),
                `region` VARCHAR(16),
                `resources` ARRAY<VARCHAR(128)>,
                `detail` STRING,
                WATERMARK FOR tx_minute AS tx_minute - INTERVAL '60' SECOND
              )
              WITH (
                'connector' = 'kinesis',
                'stream' = '{1}',
                'aws.region' = '{2}',
                'scan.stream.initpos' = '{3}',
                'format' = 'raw',
                'json.timestamp-format.standard' = 'ISO-8601'
              ) """.format(table_name, stream_name, region, initpos)

def create_table_output(table_name, stream_name, region):
    return """CREATE TABLE {0} (
                `tx_minute` TIMESTAMP(3) NOT NULL,
                `total_nb_trx_1min` BIGINT,
                `total_fee_1min` BIGINT,
                `avg_fee_1min` REAL,
              )
              WITH (
                'connector' = 'kinesis',
                'stream' = '{1}',
                'aws.region' = '{2}',
                'sink.partitioner-field-delimiter' = ';',
                'format' = 'json',
                'json.timestamp-format.standard' = 'ISO-8601'
              ) """.format(table_name, stream_name, region, initpos)

def insert_stream_s3(insert_from, insert_into):
    return """INSERT INTO {1}
              SELECT 
                FLOOR(JSON_VALUE(detail, '$.txs[0:].time') TO MINUTE) AS tx_minute,
                COUNT(JSON_VALUE(detail, '$.txs[0:].hash')) AS total_nb_trx_1min,
                SUM(JSON_VALUE(detail, '$.txs[0:].fee')) AS total_fee_1min,
                AVG(JSON_VALUE(detail, '$.txs[0:].fee')) AS avg_fee_1min
              FROM {0} 
              GROUP BY TUMBLE(tx_minute, INTERVAL '60' second) """.format(insert_from, insert_into)


def app_properties():
    file_path = '/etc/flink/application_properties.json'
    if os.path.isfile(file_path):
        with open(file_path, 'r') as file:
            contents = file.read()
            print('Contents of ' + file_path)
            print(contents)
            properties = json.loads(contents)
            return properties
    else:
        print('A file at "{}" was not found'.format(file_path))


def property_map(props, property_group_id):
    for prop in props:
        if prop["PropertyGroupId"] == property_group_id:
            return prop["PropertyMap"]


def main():
    props = app_properties()

    input_property_map = property_map(props, "producer.config.0")
    output_property_map = property_map(props, "consumer.config.0")

    input_stream = input_property_map["input.stream.name"]
    region = input_property_map["aws.region"]
    initial_position = input_property_map["flink.stream.initpos"]
    output_stream = output_property_map["output.stream.name"]

    input_table = "input_table"
    output_table = "output_table"

    table_env.execute_sql(create_table_input(input_table, input_stream, region, initial_position))

    table_env.execute_sql(create_table_output3(output_table, output_table, region))

    statement_set.add_insert_sql(insert_stream_s3(input_table, output_table))

    statement_set.execute()


if __name__ == '__main__':
    main()
