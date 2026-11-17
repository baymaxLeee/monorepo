package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/example/monorepo/telemetry/internal/application"
)

type Store struct {
	baseURL  string
	user     string
	password string
	client   *http.Client
}

func New(baseURL, user, password string) *Store {
	return &Store{baseURL: strings.TrimRight(baseURL, "/"), user: user, password: password, client: &http.Client{Timeout: 5 * time.Second}}
}

func (store *Store) Status(ctx context.Context) application.ClickHouseStatus {
	if store.baseURL == "" {
		return application.ClickHouseStatus{Configured: false, Healthy: false}
	}
	payload, err := store.query(ctx, `SELECT count() AS spans_last_hour, max(Timestamp) AS latest_span_at
		FROM otel_traces WHERE Timestamp >= now() - INTERVAL 1 HOUR FORMAT JSON`, 2*time.Second)
	if err != nil {
		message := err.Error()
		return application.ClickHouseStatus{Configured: true, Healthy: false, Error: &message}
	}
	row := firstRow(payload)
	latest := optionalString(row["latest_span_at"])
	return application.ClickHouseStatus{Configured: true, Healthy: true, SpansLastHour: intValue(row["spans_last_hour"]), LatestSpanAt: latest}
}

func (store *Store) ListTraces(ctx context.Context, limit, minutes int) ([]application.TraceSummary, error) {
	if store.baseURL == "" {
		return []application.TraceSummary{}, nil
	}
	query := fmt.Sprintf(`WITH min(toUnixTimestamp64Nano(Timestamp)) AS start_ns,
		max(toUnixTimestamp64Nano(Timestamp) + Duration) AS end_ns
		SELECT TraceId AS trace_id, min(Timestamp) AS started_at, fromUnixTimestamp64Nano(end_ns) AS ended_at,
		intDiv(end_ns - start_ns, 1000000) AS duration_ms, count() AS span_count,
		countIf(positionCaseInsensitive(StatusCode, 'error') > 0) AS error_count,
		groupUniqArray(ServiceName) AS services, argMin(SpanName, Timestamp) AS root_span_name,
		anyIf(SpanAttributes['agent.run_id'], mapContains(SpanAttributes, 'agent.run_id')) AS run_id
		FROM otel_traces WHERE Timestamp >= now() - INTERVAL %d MINUTE GROUP BY TraceId
		ORDER BY end_ns DESC LIMIT %d FORMAT JSON`, minutes, limit)
	payload, err := store.query(ctx, query, 5*time.Second)
	if err != nil {
		return nil, err
	}
	items := make([]application.TraceSummary, 0, len(payload.Data))
	for _, row := range payload.Data {
		items = append(items, application.TraceSummary{
			TraceID: stringValue(row["trace_id"]), StartedAt: stringValue(row["started_at"]), EndedAt: stringValue(row["ended_at"]),
			DurationMS: intValue(row["duration_ms"]), SpanCount: intValue(row["span_count"]), ErrorCount: intValue(row["error_count"]),
			Services: stringSlice(row["services"]), RootSpanName: optionalString(row["root_span_name"]), RunID: optionalString(row["run_id"]),
		})
	}
	return items, nil
}

func (store *Store) TraceDetail(ctx context.Context, traceID string) ([]application.TraceSpan, error) {
	if store.baseURL == "" {
		return []application.TraceSpan{}, nil
	}
	query := fmt.Sprintf(`SELECT TraceId AS trace_id, SpanId AS span_id, ParentSpanId AS parent_span_id,
		Timestamp AS timestamp, SpanName AS span_name, SpanKind AS span_kind, ServiceName AS service_name,
		round(Duration / 1000000, 3) AS duration_ms, StatusCode AS status_code, StatusMessage AS status_message,
		SpanAttributes AS span_attributes FROM otel_traces WHERE TraceId = '%s'
		ORDER BY Timestamp ASC, Duration DESC LIMIT 1000 FORMAT JSON`, traceID)
	payload, err := store.query(ctx, query, 5*time.Second)
	if err != nil {
		return nil, err
	}
	items := make([]application.TraceSpan, 0, len(payload.Data))
	for _, row := range payload.Data {
		items = append(items, application.TraceSpan{
			TraceID: stringValue(row["trace_id"]), SpanID: stringValue(row["span_id"]), ParentSpanID: stringValue(row["parent_span_id"]),
			Timestamp: stringValue(row["timestamp"]), SpanName: stringValue(row["span_name"]), SpanKind: stringValue(row["span_kind"]),
			ServiceName: stringValue(row["service_name"]), DurationMS: floatValue(row["duration_ms"]), StatusCode: stringValue(row["status_code"]),
			StatusMessage: stringValue(row["status_message"]), SpanAttributes: stringMap(row["span_attributes"]),
		})
	}
	return items, nil
}

type response struct {
	Data []map[string]any `json:"data"`
}

func (store *Store) query(ctx context.Context, query string, timeout time.Duration) (response, error) {
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	endpoint, err := url.Parse(store.baseURL + "/")
	if err != nil {
		return response{}, err
	}
	parameters := endpoint.Query()
	parameters.Set("database", "otel")
	endpoint.RawQuery = parameters.Encode()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint.String(), bytes.NewBufferString(query))
	if err != nil {
		return response{}, err
	}
	request.Header.Set("X-ClickHouse-User", store.user)
	request.Header.Set("X-ClickHouse-Key", store.password)
	result, err := store.client.Do(request)
	if err != nil {
		return response{}, err
	}
	defer result.Body.Close()
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(result.Body, 4096))
		return response{}, fmt.Errorf("ClickHouse HTTP %d: %s", result.StatusCode, strings.TrimSpace(string(detail)))
	}
	var payload response
	decoder := json.NewDecoder(result.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return response{}, err
	}
	return payload, nil
}

func firstRow(payload response) map[string]any {
	if len(payload.Data) == 0 {
		return map[string]any{}
	}
	return payload.Data[0]
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func optionalString(value any) *string {
	text := stringValue(value)
	if text == "" {
		return nil
	}
	return &text
}

func intValue(value any) int64 {
	parsed, _ := strconv.ParseInt(stringValue(value), 10, 64)
	return parsed
}

func floatValue(value any) float64 {
	parsed, _ := strconv.ParseFloat(stringValue(value), 64)
	return parsed
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, stringValue(item))
	}
	return result
}

func stringMap(value any) map[string]string {
	items, ok := value.(map[string]any)
	if !ok {
		return map[string]string{}
	}
	result := make(map[string]string, len(items))
	for key, item := range items {
		result[key] = stringValue(item)
	}
	return result
}
