package application

import (
	"context"
	"math"
	"testing"
	"time"
)

type repositoryStub struct {
	batch   RumBatch
	auth    AuthContext
	records []EventRecord
}

func (stub *repositoryStub) Ping(context.Context) error { return nil }
func (stub *repositoryStub) Ingest(_ context.Context, batch RumBatch, auth AuthContext, _ time.Time, records []EventRecord) error {
	stub.batch, stub.auth, stub.records = batch, auth, records
	return nil
}
func (stub *repositoryStub) ListErrors(context.Context, AuthContext, int) ([]ErrorEvent, error) {
	return []ErrorEvent{}, nil
}
func (stub *repositoryStub) ListPerformance(context.Context, AuthContext, int) ([]PerformanceEvent, error) {
	return []PerformanceEvent{}, nil
}

type traceStoreStub struct{}

func (traceStoreStub) Status(context.Context) ClickHouseStatus { return ClickHouseStatus{} }
func (traceStoreStub) ListTraces(context.Context, int, int) ([]TraceSummary, error) {
	return []TraceSummary{}, nil
}
func (traceStoreStub) TraceDetail(context.Context, string) ([]TraceSpan, error) {
	return []TraceSpan{}, nil
}

func TestIngestRedactsNestedCredentialsWithoutMutatingInput(t *testing.T) {
	repository := &repositoryStub{}
	service := NewService(repository, traceStoreStub{}, "development", "", 1, 1)
	payload := map[string]any{
		"name": "request", "headers": map[string]any{"Authorization": "bearer-private"},
		"items": []any{map[string]any{"token": "private"}},
	}
	batch := RumBatch{App: "platform", DeviceID: "device", SessionID: "session", Events: []RumEvent{{Type: "event", Payload: payload}}}
	if err := service.Ingest(context.Background(), batch, AuthContext{}); err != nil {
		t.Fatal(err)
	}
	got := repository.records[0].Payload
	if got["headers"].(map[string]any)["Authorization"] != "[REDACTED]" || got["items"].([]any)[0].(map[string]any)["token"] != "[REDACTED]" {
		t.Fatalf("credentials were not redacted: %#v", got)
	}
	if payload["headers"].(map[string]any)["Authorization"] != "bearer-private" {
		t.Fatal("ingestion mutated the caller payload")
	}
}

func TestIngestNormalizesInvalidMetricsAndTraceIDs(t *testing.T) {
	repository := &repositoryStub{}
	service := NewService(repository, traceStoreStub{}, "development", "", 1, 1)
	invalidTrace := "not-a-trace"
	batch := RumBatch{App: "mfe-admin", DeviceID: "device", SessionID: "session", Events: []RumEvent{{
		Type: "perform", TraceID: &invalidTrace, Payload: map[string]any{"metric": "LCP", "value": "invalid"},
	}}}
	if err := service.Ingest(context.Background(), batch, AuthContext{}); err != nil {
		t.Fatal(err)
	}
	if repository.records[0].Value != 0 || repository.records[0].TraceID != nil {
		t.Fatalf("invalid values were not normalized: %#v", repository.records[0])
	}
	if finiteFloat(math.Inf(1)) != 0 || finiteFloat("12.5") != 12.5 {
		t.Fatal("finite metric normalization changed")
	}
}

func TestSamplingDropsOnlyConfiguredEventRowsAndKeepsSessionBatch(t *testing.T) {
	repository := &repositoryStub{}
	service := NewService(repository, traceStoreStub{}, "development", "", 0, 0)
	service.random = func() float64 { return 0.5 }
	batch := RumBatch{App: "platform", DeviceID: "device", SessionID: "session", Events: []RumEvent{
		{Type: "perform", Payload: map[string]any{}}, {Type: "event", Payload: map[string]any{}}, {Type: "error", Payload: map[string]any{}},
	}}
	if err := service.Ingest(context.Background(), batch, AuthContext{}); err != nil {
		t.Fatal(err)
	}
	if len(repository.records) != 1 || repository.records[0].Type != "error" || len(repository.batch.Events) != 3 {
		t.Fatalf("sampling changed batch semantics: %#v", repository.records)
	}
}

func TestValidateBatchRejectsOversizedPayloadAndNormalizesValidTrace(t *testing.T) {
	trace := "ABCDEF0123456789ABCDEF0123456789"
	batch := RumBatch{App: "platform", DeviceID: "device", SessionID: "session", Events: []RumEvent{{Type: "event", TraceID: &trace, Payload: map[string]any{}}}}
	if err := ValidateBatch(batch); err != nil {
		t.Fatal(err)
	}
	if *batch.Events[0].TraceID != "abcdef0123456789abcdef0123456789" {
		t.Fatalf("trace id not normalized: %q", *batch.Events[0].TraceID)
	}
	batch.Events[0].Payload = map[string]any{"value": string(make([]byte, maxPayloadBytes))}
	if err := ValidateBatch(batch); err == nil {
		t.Fatal("oversized payload was accepted")
	}
}
