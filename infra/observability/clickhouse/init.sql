CREATE DATABASE IF NOT EXISTS telemetry;

CREATE TABLE IF NOT EXISTS telemetry.events_perform
(
    ts_server DateTime64(3, 'UTC'),
    ts_client Nullable(DateTime64(3, 'UTC')),
    app LowCardinality(String),
    env LowCardinality(String),
    release String,
    user_id Nullable(String),
    username Nullable(String),
    is_admin UInt8,
    device_id String,
    session_id String,
    trace_id Nullable(String),
    route String,
    user_agent String,
    metric LowCardinality(String),
    value Float64,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts_server)
ORDER BY (app, metric, ts_server)
TTL toDateTime(ts_server) + INTERVAL 60 DAY;

CREATE TABLE IF NOT EXISTS telemetry.events_error
(
    ts_server DateTime64(3, 'UTC'),
    ts_client Nullable(DateTime64(3, 'UTC')),
    app LowCardinality(String),
    env LowCardinality(String),
    release String,
    user_id Nullable(String),
    username Nullable(String),
    is_admin UInt8,
    device_id String,
    session_id String,
    trace_id Nullable(String),
    route String,
    user_agent String,
    fingerprint String,
    name String,
    message String,
    stack String,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts_server)
ORDER BY (app, fingerprint, ts_server)
TTL toDateTime(ts_server) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS telemetry.events_warning
(
    ts_server DateTime64(3, 'UTC'),
    ts_client Nullable(DateTime64(3, 'UTC')),
    app LowCardinality(String),
    env LowCardinality(String),
    release String,
    user_id Nullable(String),
    username Nullable(String),
    is_admin UInt8,
    device_id String,
    session_id String,
    trace_id Nullable(String),
    route String,
    user_agent String,
    level LowCardinality(String),
    message String,
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts_server)
ORDER BY (app, level, ts_server)
TTL toDateTime(ts_server) + INTERVAL 14 DAY;

CREATE TABLE IF NOT EXISTS telemetry.events_business
(
    ts_server DateTime64(3, 'UTC'),
    ts_client Nullable(DateTime64(3, 'UTC')),
    app LowCardinality(String),
    env LowCardinality(String),
    release String,
    user_id Nullable(String),
    username Nullable(String),
    is_admin UInt8,
    device_id String,
    session_id String,
    trace_id Nullable(String),
    route String,
    user_agent String,
    name LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts_server)
ORDER BY (app, name, ts_server)
TTL toDateTime(ts_server) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS telemetry.sessions
(
    ts_server DateTime64(3, 'UTC'),
    app LowCardinality(String),
    env LowCardinality(String),
    release String,
    user_id Nullable(String),
    username Nullable(String),
    is_admin UInt8,
    device_id String,
    session_id String,
    route String,
    user_agent String,
    event_count UInt32
)
ENGINE = ReplacingMergeTree(ts_server)
PARTITION BY toYYYYMM(ts_server)
ORDER BY (app, session_id)
TTL toDateTime(ts_server) + INTERVAL 60 DAY;

CREATE TABLE IF NOT EXISTS telemetry.errors_by_fingerprint_daily
(
    day Date,
    app LowCardinality(String),
    fingerprint String,
    count SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (app, fingerprint, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry.mv_errors_by_fingerprint_daily
TO telemetry.errors_by_fingerprint_daily
AS
SELECT
    toDate(ts_server) AS day,
    app,
    fingerprint,
    count() AS count
FROM telemetry.events_error
GROUP BY day, app, fingerprint;

CREATE TABLE IF NOT EXISTS telemetry.vitals_p75_by_route_daily
(
    day Date,
    app LowCardinality(String),
    route String,
    metric LowCardinality(String),
    values AggregateFunction(quantile(0.75), Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (app, route, metric, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry.mv_vitals_p75_by_route_daily
TO telemetry.vitals_p75_by_route_daily
AS
SELECT
    toDate(ts_server) AS day,
    app,
    route,
    metric,
    quantileState(0.75)(value) AS values
FROM telemetry.events_perform
GROUP BY day, app, route, metric;
