package openapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func healthRouter(check func(context.Context) error) http.Handler {
	transport := &Router{readiness: check}
	router := chi.NewRouter()
	router.Get("/livez", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", transport.readinessRoute())
	router.Get("/healthz", transport.readinessRoute())
	return router
}

func TestServiceAuthentication(t *testing.T) {
	handler := serviceAuthentication(map[string]string{"executor": "executor-token"})(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		},
	))

	for _, tc := range []struct {
		name   string
		caller string
		token  string
		want   int
	}{
		{name: "matching caller credential", caller: "executor", token: "executor-token", want: http.StatusNoContent},
		{name: "different caller credential", caller: "executor", token: "chat-token", want: http.StatusForbidden},
		{name: "unknown caller without token", caller: "unknown", want: http.StatusForbidden},
		{name: "missing caller", token: "executor-token", want: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/internal/test", nil)
			request.Header.Set("X-Caller-Service", tc.caller)
			request.Header.Set("X-Internal-Token", tc.token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("status = %d, want %d", response.Code, tc.want)
			}
		})
	}
}

func TestHealthRoutesDoNotRequireServiceAuthentication(t *testing.T) {
	for _, path := range []string{"/livez", "/readyz", "/healthz"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			response := httptest.NewRecorder()
			healthRouter(func(context.Context) error { return nil }).ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
		})
	}
}

func TestReadinessReportsDependencyFailure(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	healthRouter(func(context.Context) error { return errors.New("dependency unavailable") }).ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}
