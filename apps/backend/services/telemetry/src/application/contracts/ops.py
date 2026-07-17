"""Operations observability status schemas."""

from pydantic import BaseModel


class ObservabilityCapability(BaseModel):
    key: str
    label: str
    status: str
    detail: str


class ClickHouseStatus(BaseModel):
    configured: bool
    healthy: bool
    spans_last_hour: int
    latest_span_at: str | None = None
    error: str | None = None


class ObservabilityStatusResponse(BaseModel):
    otlp_endpoint: str | None
    trace_retention_days: int
    clickhouse: ClickHouseStatus
    capabilities: list[ObservabilityCapability]


class TraceSummary(BaseModel):
    trace_id: str
    started_at: str
    ended_at: str
    duration_ms: int
    span_count: int
    error_count: int
    services: list[str]
    root_span_name: str | None = None
    run_id: str | None = None


class TraceListResponse(BaseModel):
    items: list[TraceSummary]


class TraceSpan(BaseModel):
    trace_id: str
    span_id: str
    parent_span_id: str
    timestamp: str
    span_name: str
    span_kind: str
    service_name: str
    duration_ms: float
    status_code: str
    status_message: str
    span_attributes: dict[str, str]


class TraceDetailResponse(BaseModel):
    trace_id: str
    spans: list[TraceSpan]
