package application

import (
	"context"
	"time"
)

type AuthContext struct {
	UserID    string
	Username  string
	Email     string
	ClientIP  string
	UserAgent string
	Roles     []string
}

func (auth AuthContext) IsAdmin() bool {
	for _, role := range auth.Roles {
		if role == "super_admin" {
			return true
		}
	}
	return false
}

type RumBatch struct {
	App       string     `json:"app"`
	Release   string     `json:"release"`
	DeviceID  string     `json:"device_id"`
	SessionID string     `json:"session_id"`
	UserAgent string     `json:"user_agent"`
	Events    []RumEvent `json:"events"`
}

type RumEvent struct {
	Type     string         `json:"type"`
	TSClient *int64         `json:"ts_client"`
	TraceID  *string        `json:"trace_id"`
	Route    string         `json:"route"`
	Payload  map[string]any `json:"payload"`
}

type EventRecord struct {
	Type        string
	TSClient    *time.Time
	TraceID     *string
	Route       string
	Payload     map[string]any
	Metric      string
	Value       float64
	Fingerprint string
	Name        string
	Message     string
	Stack       string
	Level       string
}

type ErrorEvent struct {
	TSServer    time.Time      `json:"ts_server"`
	App         string         `json:"app"`
	Release     string         `json:"release"`
	UserID      *string        `json:"user_id"`
	Username    *string        `json:"username"`
	IsAdmin     bool           `json:"is_admin"`
	DeviceID    string         `json:"device_id"`
	SessionID   string         `json:"session_id"`
	TraceID     *string        `json:"trace_id"`
	Route       string         `json:"route"`
	Fingerprint string         `json:"fingerprint"`
	Name        string         `json:"name"`
	Message     string         `json:"message"`
	Stack       string         `json:"stack"`
	Payload     map[string]any `json:"payload"`
}

type ErrorListResponse struct {
	Items []ErrorEvent `json:"items"`
}

type PerformanceEvent struct {
	TSServer  time.Time      `json:"ts_server"`
	App       string         `json:"app"`
	Release   string         `json:"release"`
	UserID    *string        `json:"user_id"`
	Username  *string        `json:"username"`
	IsAdmin   bool           `json:"is_admin"`
	DeviceID  string         `json:"device_id"`
	SessionID string         `json:"session_id"`
	TraceID   *string        `json:"trace_id"`
	Route     string         `json:"route"`
	Metric    string         `json:"metric"`
	Value     float64        `json:"value"`
	Payload   map[string]any `json:"payload"`
}

type PerformanceListResponse struct {
	Items []PerformanceEvent `json:"items"`
}

type ClickHouseStatus struct {
	Configured    bool    `json:"configured"`
	Healthy       bool    `json:"healthy"`
	SpansLastHour int64   `json:"spans_last_hour"`
	LatestSpanAt  *string `json:"latest_span_at"`
	Error         *string `json:"error"`
}

type ObservabilityCapability struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type ObservabilityStatusResponse struct {
	OTLPEndpoint       *string                   `json:"otlp_endpoint"`
	TraceRetentionDays int                       `json:"trace_retention_days"`
	ClickHouse         ClickHouseStatus          `json:"clickhouse"`
	Capabilities       []ObservabilityCapability `json:"capabilities"`
}

type TraceSummary struct {
	TraceID      string   `json:"trace_id"`
	StartedAt    string   `json:"started_at"`
	EndedAt      string   `json:"ended_at"`
	DurationMS   int64    `json:"duration_ms"`
	SpanCount    int64    `json:"span_count"`
	ErrorCount   int64    `json:"error_count"`
	Services     []string `json:"services"`
	RootSpanName *string  `json:"root_span_name"`
	RunID        *string  `json:"run_id"`
}

type TraceListResponse struct {
	Items []TraceSummary `json:"items"`
}

type TraceSpan struct {
	TraceID        string            `json:"trace_id"`
	SpanID         string            `json:"span_id"`
	ParentSpanID   string            `json:"parent_span_id"`
	Timestamp      string            `json:"timestamp"`
	SpanName       string            `json:"span_name"`
	SpanKind       string            `json:"span_kind"`
	ServiceName    string            `json:"service_name"`
	DurationMS     float64           `json:"duration_ms"`
	StatusCode     string            `json:"status_code"`
	StatusMessage  string            `json:"status_message"`
	SpanAttributes map[string]string `json:"span_attributes"`
}

type TraceDetailResponse struct {
	TraceID string      `json:"trace_id"`
	Spans   []TraceSpan `json:"spans"`
}

type Repository interface {
	Ping(context.Context) error
	Ingest(context.Context, RumBatch, AuthContext, time.Time, []EventRecord) error
	ListErrors(context.Context, AuthContext, int) ([]ErrorEvent, error)
	ListPerformance(context.Context, AuthContext, int) ([]PerformanceEvent, error)
}

type TraceStore interface {
	Status(context.Context) ClickHouseStatus
	ListTraces(context.Context, int, int) ([]TraceSummary, error)
	TraceDetail(context.Context, string) ([]TraceSpan, error)
}
