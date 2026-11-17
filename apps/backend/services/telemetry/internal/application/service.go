package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxPayloadBytes = 64 * 1024

var (
	sensitiveKey = regexp.MustCompile(`(?i)(password|token|authorization|cookie|secret)`)
	digits       = regexp.MustCompile(`\d+`)
	hexTraceID   = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

type Service struct {
	repository        Repository
	traces            TraceStore
	environment       string
	otlpEndpoint      string
	sampleRatePerform float64
	sampleRateEvent   float64
	now               func() time.Time
	random            func() float64
}

func NewService(repository Repository, traces TraceStore, environment, otlpEndpoint string, sampleRatePerform, sampleRateEvent float64) *Service {
	return &Service{
		repository: repository, traces: traces, environment: environment, otlpEndpoint: otlpEndpoint,
		sampleRatePerform: sampleRatePerform, sampleRateEvent: sampleRateEvent,
		now: func() time.Time { return time.Now().UTC() }, random: rand.Float64,
	}
}

func (service *Service) Ping(ctx context.Context) error { return service.repository.Ping(ctx) }

func (service *Service) Ingest(ctx context.Context, batch RumBatch, auth AuthContext) error {
	if err := ValidateBatch(batch); err != nil {
		return err
	}
	records := make([]EventRecord, 0, len(batch.Events))
	for _, event := range batch.Events {
		if event.Type == "perform" && !service.sample(service.sampleRatePerform) {
			continue
		}
		if event.Type == "event" && !service.sample(service.sampleRateEvent) {
			continue
		}
		payload := redactMap(event.Payload)
		record := EventRecord{
			Type: event.Type, TSClient: clientTime(event.TSClient), TraceID: event.TraceID,
			Route: event.Route, Payload: payload,
		}
		switch event.Type {
		case "perform":
			record.Metric = text(first(payload["metric"], payload["name"], "unknown"), 64)
			record.Value = finiteFloat(payload["value"])
		case "error":
			record.Name = text(first(payload["name"], "Error"), 256)
			record.Message = stringValue(payload["message"])
			record.Stack = stringValue(payload["stack"])
			record.Fingerprint = fingerprint(record.Name, record.Message, record.Stack)
		case "warning":
			record.Level = text(first(payload["level"], "warning"), 32)
			record.Message = stringValue(payload["message"])
		case "event":
			record.Name = text(first(payload["name"], "event"), 128)
		}
		records = append(records, record)
	}
	return service.repository.Ingest(ctx, batch, auth, service.now(), records)
}

func (service *Service) Errors(ctx context.Context, auth AuthContext, limit int) (ErrorListResponse, error) {
	items, err := service.repository.ListErrors(ctx, auth, min(limit, 500))
	return ErrorListResponse{Items: items}, err
}

func (service *Service) Performance(ctx context.Context, auth AuthContext, limit int) (PerformanceListResponse, error) {
	items, err := service.repository.ListPerformance(ctx, auth, min(limit, 1000))
	return PerformanceListResponse{Items: items}, err
}

func (service *Service) ObservabilityStatus(ctx context.Context) ObservabilityStatusResponse {
	status := service.traces.Status(ctx)
	clickhouseState := "disabled"
	if status.Configured {
		clickhouseState = "enabled"
	}
	var endpoint *string
	if service.otlpEndpoint != "" {
		endpoint = &service.otlpEndpoint
	}
	return ObservabilityStatusResponse{
		OTLPEndpoint: endpoint, TraceRetentionDays: 7, ClickHouse: status,
		Capabilities: []ObservabilityCapability{
			{Key: "traceparent", Label: "W3C traceparent", Status: "enabled", Detail: "gateway、TS 服务和 Go 服务会传播标准 traceparent"},
			{Key: "clickhouse", Label: "ClickHouse OLAP", Status: clickhouseState, Detail: "单机低资源配置，默认 trace TTL 7 天"},
			{Key: "agent-spans", Label: "Agent lifecycle spans", Status: "enabled", Detail: "chat agent model step / tool call 写入开发者 trace"},
			{Key: "frontend-rum", Label: "Frontend RUM", Status: "enabled", Detail: "现有 telemetry 服务继续保存前端错误与性能事件"},
		},
	}
}

func (service *Service) Traces(ctx context.Context, limit, minutes int) TraceListResponse {
	items, err := service.traces.ListTraces(ctx, limit, minutes)
	if err != nil {
		items = []TraceSummary{}
	}
	return TraceListResponse{Items: items}
}

func (service *Service) Trace(ctx context.Context, traceID string) (TraceDetailResponse, error) {
	normalized := strings.ToLower(strings.TrimSpace(traceID))
	if !hexTraceID.MatchString(normalized) {
		return TraceDetailResponse{}, errors.New("invalid trace_id")
	}
	spans, err := service.traces.TraceDetail(ctx, normalized)
	if err != nil {
		spans = []TraceSpan{}
	}
	return TraceDetailResponse{TraceID: normalized, Spans: spans}, nil
}

func ValidateBatch(batch RumBatch) error {
	if batch.App != "platform" && batch.App != "mfe-admin" {
		return errors.New("app must be platform or mfe-admin")
	}
	if len(batch.Release) > 128 || len(batch.DeviceID) < 1 || len(batch.DeviceID) > 128 || len(batch.SessionID) < 1 || len(batch.SessionID) > 128 || len(batch.UserAgent) > 512 {
		return errors.New("batch field length is invalid")
	}
	if len(batch.Events) < 1 || len(batch.Events) > 100 {
		return errors.New("events must contain between 1 and 100 items")
	}
	for index := range batch.Events {
		event := &batch.Events[index]
		switch event.Type {
		case "perform", "error", "warning", "event":
		default:
			return fmt.Errorf("events[%d].type is invalid", index)
		}
		if len(event.Route) > 256 {
			return fmt.Errorf("events[%d].route is too long", index)
		}
		if event.Payload == nil {
			event.Payload = map[string]any{}
		}
		if err := validateJSONValue(event.Payload); err != nil {
			return fmt.Errorf("events[%d].payload: %w", index, err)
		}
		encoded, err := json.Marshal(event.Payload)
		if err != nil || len(encoded) > maxPayloadBytes {
			return fmt.Errorf("events[%d].payload must not exceed %d bytes", index, maxPayloadBytes)
		}
		if event.TraceID != nil {
			normalized := strings.ToLower(*event.TraceID)
			if *event.TraceID == "" || !hexTraceID.MatchString(normalized) {
				event.TraceID = nil
			} else {
				event.TraceID = &normalized
			}
		}
	}
	return nil
}

func validateJSONValue(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			if len([]rune(key)) > 256 {
				return errors.New("payload keys must not exceed 256 characters")
			}
			if err := validateJSONValue(item); err != nil {
				return err
			}
		}
	case []any:
		for _, item := range typed {
			if err := validateJSONValue(item); err != nil {
				return err
			}
		}
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return errors.New("payload numbers must be finite")
		}
	}
	return nil
}

func (service *Service) sample(rate float64) bool {
	return rate >= 1 || service.random() <= max(rate, 0)
}

func redactMap(value map[string]any) map[string]any {
	return redact(value).(map[string]any)
}

func redact(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if sensitiveKey.MatchString(key) {
				result[key] = "[REDACTED]"
			} else {
				result[key] = redact(item)
			}
		}
		return result
	case []any:
		limit := min(len(typed), 50)
		result := make([]any, limit)
		for index := range limit {
			result[index] = redact(typed[index])
		}
		return result
	case string:
		return text(typed, 8000)
	default:
		return value
	}
}

func finiteFloat(value any) float64 {
	var parsed float64
	var err error
	switch typed := value.(type) {
	case float64:
		parsed = typed
	case json.Number:
		parsed, err = typed.Float64()
	case string:
		parsed, err = strconv.ParseFloat(typed, 64)
	default:
		return 0
	}
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}

func clientTime(milliseconds *int64) *time.Time {
	if milliseconds == nil {
		return nil
	}
	value := time.UnixMilli(*milliseconds).UTC()
	if value.Year() < 1 || value.Year() > 9999 {
		return nil
	}
	return &value
}

func fingerprint(name, message, stack string) string {
	lines := strings.Split(stack, "\n")
	frames := strings.Join(lines[:min(len(lines), 3)], "\n")
	normalized := digits.ReplaceAllString(message, "<n>")
	sum := sha256.Sum256([]byte(name + "\n" + normalized + "\n" + frames))
	return hex.EncodeToString(sum[:])[:32]
}

func first(values ...any) any {
	for _, value := range values {
		if value != nil && stringValue(value) != "" {
			return value
		}
	}
	return ""
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func text(value any, maximum int) string {
	characters := []rune(stringValue(value))
	if len(characters) > maximum {
		characters = characters[:maximum]
	}
	return string(characters)
}
