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
	router.Use(serviceAuthentication("internal-token"))
	router.Get("/livez", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", transport.readinessRoute())
	router.Get("/healthz", transport.readinessRoute())
	return router
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
