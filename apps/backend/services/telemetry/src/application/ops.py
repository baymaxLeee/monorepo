"""Operations observability status service."""

import asyncio
import json
import re
import urllib.error
import urllib.request
from typing import cast
from urllib.parse import urlencode

from bootstrap.config import get_settings
from kernel.errors import RequestError

from application.contracts.ops import (
    ClickHouseStatus,
    ObservabilityCapability,
    ObservabilityStatusResponse,
    TraceDetailResponse,
    TraceListResponse,
    TraceSpan,
    TraceSummary,
)

TRACE_RETENTION_DAYS = 7
_TRACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
JsonRow = dict[str, object]


async def get_observability_status() -> ObservabilityStatusResponse:
    settings = get_settings()
    clickhouse = await asyncio.to_thread(
        _read_clickhouse_status,
        settings.clickhouse_http_url,
        settings.clickhouse_user,
        settings.clickhouse_password,
    )
    return ObservabilityStatusResponse(
        otlp_endpoint=settings.otel_exporter_otlp_endpoint or None,
        trace_retention_days=TRACE_RETENTION_DAYS,
        clickhouse=clickhouse,
        capabilities=[
            ObservabilityCapability(
                key="traceparent",
                label="W3C traceparent",
                status="enabled",
                detail="gateway、TS 服务和 Python 服务会传播标准 traceparent",
            ),
            ObservabilityCapability(
                key="clickhouse",
                label="ClickHouse OLAP",
                status="enabled" if clickhouse.configured else "disabled",
                detail="单机低资源配置，默认 trace TTL 7 天",
            ),
            ObservabilityCapability(
                key="agent-spans",
                label="Agent lifecycle spans",
                status="enabled",
                detail="chat agent model step / tool call 写入开发者 trace",
            ),
            ObservabilityCapability(
                key="frontend-rum",
                label="Frontend RUM",
                status="enabled",
                detail="现有 telemetry 服务继续保存前端错误与性能事件",
            ),
        ],
    )


def _read_clickhouse_status(base_url: str, user: str, password: str) -> ClickHouseStatus:
    if not base_url:
        return ClickHouseStatus(configured=False, healthy=False, spans_last_hour=0)
    sql = """
        SELECT
          count() AS spans_last_hour,
          max(Timestamp) AS latest_span_at
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL 1 HOUR
        FORMAT JSON
    """
    try:
        payload = _clickhouse_json_query(base_url, user, password, sql, timeout=2)
        row = next(iter(_data_rows(payload)), {})
        return ClickHouseStatus(
            configured=True,
            healthy=True,
            spans_last_hour=_int(row.get("spans_last_hour")),
            latest_span_at=_none_if_empty(row.get("latest_span_at")),
        )
    except (
        OSError,
        urllib.error.URLError,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        ValueError,
    ) as exc:
        return ClickHouseStatus(
            configured=True,
            healthy=False,
            spans_last_hour=0,
            error=str(exc),
        )


async def list_traces(*, limit: int, minutes: int) -> TraceListResponse:
    settings = get_settings()
    try:
        rows = await asyncio.to_thread(
            _query_trace_summaries,
            settings.clickhouse_http_url,
            settings.clickhouse_user,
            settings.clickhouse_password,
            limit,
            minutes,
        )
    except (
        OSError,
        urllib.error.URLError,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        ValueError,
    ):
        rows = []
    return TraceListResponse(items=rows)


async def get_trace_detail(trace_id: str) -> TraceDetailResponse:
    normalized = trace_id.strip().lower()
    if not _TRACE_ID_RE.match(normalized):
        raise RequestError("invalid trace_id")
    settings = get_settings()
    try:
        spans = await asyncio.to_thread(
            _query_trace_spans,
            settings.clickhouse_http_url,
            settings.clickhouse_user,
            settings.clickhouse_password,
            normalized,
        )
    except (
        OSError,
        urllib.error.URLError,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        ValueError,
    ):
        spans = []
    return TraceDetailResponse(trace_id=normalized, spans=spans)


def _query_trace_summaries(
    base_url: str,
    user: str,
    password: str,
    limit: int,
    minutes: int,
) -> list[TraceSummary]:
    if not base_url:
        return []
    sql = f"""
        WITH
          min(toUnixTimestamp64Nano(Timestamp)) AS start_ns,
          max(toUnixTimestamp64Nano(Timestamp) + Duration) AS end_ns
        SELECT
          TraceId AS trace_id,
          min(Timestamp) AS started_at,
          fromUnixTimestamp64Nano(end_ns) AS ended_at,
          intDiv(end_ns - start_ns, 1000000) AS duration_ms,
          count() AS span_count,
          countIf(positionCaseInsensitive(StatusCode, 'error') > 0) AS error_count,
          groupUniqArray(ServiceName) AS services,
          argMin(SpanName, Timestamp) AS root_span_name,
          anyIf(SpanAttributes['agent.run_id'], mapContains(SpanAttributes, 'agent.run_id')) AS run_id
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {minutes:d} MINUTE
        GROUP BY TraceId
        ORDER BY end_ns DESC
        LIMIT {limit:d}
        FORMAT JSON
    """
    payload = _clickhouse_json_query(base_url, user, password, sql)
    return [
        TraceSummary(
            trace_id=str(row.get("trace_id", "")),
            started_at=str(row.get("started_at", "")),
            ended_at=str(row.get("ended_at", "")),
            duration_ms=_int(row.get("duration_ms")),
            span_count=_int(row.get("span_count")),
            error_count=_int(row.get("error_count")),
            services=_string_list(row.get("services")),
            root_span_name=_none_if_empty(row.get("root_span_name")),
            run_id=_none_if_empty(row.get("run_id")),
        )
        for row in _data_rows(payload)
    ]


def _query_trace_spans(base_url: str, user: str, password: str, trace_id: str) -> list[TraceSpan]:
    if not base_url:
        return []
    sql = f"""
        SELECT
          TraceId AS trace_id,
          SpanId AS span_id,
          ParentSpanId AS parent_span_id,
          Timestamp AS timestamp,
          SpanName AS span_name,
          SpanKind AS span_kind,
          ServiceName AS service_name,
          round(Duration / 1000000, 3) AS duration_ms,
          StatusCode AS status_code,
          StatusMessage AS status_message,
          SpanAttributes AS span_attributes
        FROM otel_traces
        WHERE TraceId = '{trace_id}'
        ORDER BY Timestamp ASC, Duration DESC
        LIMIT 1000
        FORMAT JSON
    """
    payload = _clickhouse_json_query(base_url, user, password, sql)
    return [
        TraceSpan(
            trace_id=str(row.get("trace_id", "")),
            span_id=str(row.get("span_id", "")),
            parent_span_id=str(row.get("parent_span_id", "")),
            timestamp=str(row.get("timestamp", "")),
            span_name=str(row.get("span_name", "")),
            span_kind=str(row.get("span_kind", "")),
            service_name=str(row.get("service_name", "")),
            duration_ms=_float(row.get("duration_ms")),
            status_code=str(row.get("status_code", "")),
            status_message=str(row.get("status_message", "")),
            span_attributes=_string_map(row.get("span_attributes")),
        )
        for row in _data_rows(payload)
    ]


def _clickhouse_json_query(
    base_url: str,
    user: str,
    password: str,
    sql: str,
    *,
    timeout: float = 5,
) -> dict[str, object]:
    params = urlencode({"database": "otel", "user": user, "password": password})
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/?{params}",
        data=sql.encode(),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace").strip()
        message = f"ClickHouse HTTP {exc.code}"
        if detail:
            message = f"{message}: {detail}"
        raise ValueError(message) from exc
    return cast(dict[str, object], payload) if isinstance(payload, dict) else {}


def _data_rows(payload: dict[str, object]) -> list[JsonRow]:
    raw = payload.get("data")
    if not isinstance(raw, list):
        return []
    return [cast(JsonRow, row) for row in raw if isinstance(row, dict)]


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def _string_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(k): str(v) for k, v in value.items()}


def _int(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float | str):
        return int(value)
    return 0


def _float(value: object) -> float:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        return float(value)
    return 0


def _none_if_empty(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None
