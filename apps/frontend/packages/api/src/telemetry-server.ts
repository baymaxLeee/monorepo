import { type ApiRequestConfig, request } from "./http";

type RequestOptions = Pick<ApiRequestConfig, "skipErrorNotify">;

export interface TelemetryErrorEvent {
  app: string;
  device_id: string;
  fingerprint: string;
  is_admin: boolean;
  message: string;
  name: string;
  payload: Record<string, unknown>;
  release: string;
  route: string;
  session_id: string;
  stack: string;
  trace_id: string | null;
  ts_server: string;
  user_id: string | null;
  username: string | null;
}

export interface TelemetryPerformanceEvent {
  app: string;
  device_id: string;
  is_admin: boolean;
  metric: string;
  payload: Record<string, unknown>;
  release: string;
  route: string;
  session_id: string;
  trace_id: string | null;
  ts_server: string;
  user_id: string | null;
  username: string | null;
  value: number;
}

export interface ObservabilityCapability {
  key: string;
  label: string;
  status: string;
  detail: string;
}

export interface ClickHouseStatus {
  configured: boolean;
  healthy: boolean;
  spans_last_hour: number;
  latest_span_at: string | null;
  error: string | null;
}

export interface ObservabilityStatus {
  otlp_endpoint: string | null;
  trace_retention_days: number;
  clickhouse: ClickHouseStatus;
  capabilities: ObservabilityCapability[];
}

export interface TraceSummary {
  trace_id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  span_count: number;
  error_count: number;
  services: string[];
  root_span_name: string | null;
  run_id: string | null;
}

export interface TraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  timestamp: string;
  span_name: string;
  span_kind: string;
  service_name: string;
  duration_ms: number;
  status_code: string;
  status_message: string;
  span_attributes: Record<string, string>;
}

export function fetchTelemetryErrors(
  limit = 100,
  options?: RequestOptions,
): Promise<{
  items: TelemetryErrorEvent[];
}> {
  return request({
    url: "/api/telemetry-server/errors",
    method: "GET",
    params: { limit },
    ...options,
  });
}

export function fetchTelemetryPerformance(
  limit = 200,
  options?: RequestOptions,
): Promise<{
  items: TelemetryPerformanceEvent[];
}> {
  return request({
    url: "/api/telemetry-server/performance",
    method: "GET",
    params: { limit },
    ...options,
  });
}

export function fetchObservabilityStatus(
  options?: RequestOptions,
): Promise<ObservabilityStatus> {
  return request({
    url: "/api/telemetry-server/ops/observability",
    method: "GET",
    ...options,
  });
}

export function fetchObservabilityTraces(
  input: { limit?: number; minutes?: number } = {},
  options?: RequestOptions,
): Promise<{ items: TraceSummary[] }> {
  return request({
    url: "/api/telemetry-server/ops/traces",
    method: "GET",
    params: { limit: input.limit ?? 50, minutes: input.minutes ?? 60 },
    ...options,
  });
}

export function fetchObservabilityTrace(
  traceId: string,
  options?: RequestOptions,
): Promise<{ trace_id: string; spans: TraceSpan[] }> {
  return request({
    url: `/api/telemetry-server/ops/traces/${traceId}`,
    method: "GET",
    ...options,
  });
}
