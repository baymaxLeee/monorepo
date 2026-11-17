package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/telemetry/internal/application"
)

type repositoryStub struct{ ingested bool }

func (stub *repositoryStub) Ping(context.Context) error { return nil }
func (stub *repositoryStub) Ingest(context.Context, application.RumBatch, application.AuthContext, time.Time, []application.EventRecord) error {
	stub.ingested = true
	return nil
}
func (stub *repositoryStub) ListErrors(context.Context, application.AuthContext, int) ([]application.ErrorEvent, error) {
	return []application.ErrorEvent{}, nil
}
func (stub *repositoryStub) ListPerformance(context.Context, application.AuthContext, int) ([]application.PerformanceEvent, error) {
	return []application.PerformanceEvent{}, nil
}

type traceStoreStub struct{}

func (traceStoreStub) Status(context.Context) application.ClickHouseStatus {
	return application.ClickHouseStatus{}
}
func (traceStoreStub) ListTraces(context.Context, int, int) ([]application.TraceSummary, error) {
	return []application.TraceSummary{}, nil
}
func (traceStoreStub) TraceDetail(context.Context, string) ([]application.TraceSpan, error) {
	return []application.TraceSpan{}, nil
}

func testHandler(repository *repositoryStub) http.Handler {
	service := application.NewService(repository, traceStoreStub{}, "development", "", 1, 1)
	return New(service)
}

func TestAnonymousRUMWriteRemainsAllowed(t *testing.T) {
	repository := &repositoryStub{}
	request := httptest.NewRequest(http.MethodPost, "/rum/batch", strings.NewReader(`{
		"app":"platform","device_id":"device","session_id":"session","events":[{"type":"event","payload":{}}]
	}`))
	response := httptest.NewRecorder()
	testHandler(repository).ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || !repository.ingested {
		t.Fatalf("anonymous ingest = %d, ingested=%v, body=%s", response.Code, repository.ingested, response.Body.String())
	}
}

func TestQueryRequiresGatewayIdentity(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/errors", nil)
	response := httptest.NewRecorder()
	testHandler(&repositoryStub{}).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous query = %d, want 401", response.Code)
	}
}

func TestOpsRequiresSuperAdmin(t *testing.T) {
	handler := testHandler(&repositoryStub{})
	request := httptest.NewRequest(http.MethodGet, "/ops/observability", nil)
	request.Header.Set("X-Auth-User-ID", "user-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("ordinary user ops response = %d, want 403", response.Code)
	}

	adminRequest := httptest.NewRequest(http.MethodGet, "/ops/observability", nil)
	adminRequest.Header.Set("X-Auth-User-ID", "admin-1")
	adminRequest.Header.Set("X-Auth-Roles", "member, super_admin")
	adminResponse := httptest.NewRecorder()
	handler.ServeHTTP(adminResponse, adminRequest)
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("super admin ops response = %d, want 200", adminResponse.Code)
	}
}

func TestQueryLimitsStillRejectOutOfRangeValues(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/performance?limit=1001", nil)
	request.Header.Set("X-Auth-User-ID", "user-1")
	response := httptest.NewRecorder()
	testHandler(&repositoryStub{}).ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid limit response = %d, want 422", response.Code)
	}
}
