CREATE OR REPLACE STREAM "DESTINATION_SQL_STREAM" (
    "tx_hour"         TIMESTAMP NOT NULL,
    "total_nb_trx_1h" BIGINT,
    "total_fee_1h"    BIGINT,
    "avg_fee_1h"      REAL
);
CREATE OR REPLACE PUMP "STREAM_PUMP" AS INSERT INTO "DESTINATION_SQL_STREAM"
    SELECT STREAM  
        FLOOR(s.ROWTIME TO MINUTE),
        COUNT("tx_hash"), 
        SUM("tx_fee"), 
        AVG("tx_fee")
        FROM "SOURCE_SQL_STREAM_001" AS s
        GROUP BY FLOOR(s.ROWTIME TO MINUTE);
