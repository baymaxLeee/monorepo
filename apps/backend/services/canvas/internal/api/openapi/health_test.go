package openapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/example/monorepo/httpserver-go"
)

func healthRouter(check func(context.Context) error) http.Handler {
	transport := &Router{readiness: check}
	router := httpserver.New("canvas-test")
	router.GET("/livez", func(c *gin.Context) {
		writeJSON(c.Writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.GET("/readyz", transport.readinessRoute())
	router.GET("/healthz", transport.readinessRoute())
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

func TestRouterRegistersGinRoutesWithoutConflicts(t *testing.T) {
	if handler := NewRouter(nil, nil, nil, nil, nil, nil, nil, nil, nil); handler == nil {
		t.Fatal("router is nil")
	}
}

func TestPostActionsRequireTheDeclaredSuffix(t *testing.T) {
	router := httpserver.New("canvas-test")
	postActions(router, "/runs/:taskRunIdAction", "taskRunId", map[string]gin.HandlerFunc{
		":cancel": func(c *gin.Context) { c.String(http.StatusOK, c.Param("taskRunId")) },
	})

	for _, test := range []struct {
		path string
		code int
		body string
	}{
		{path: "/runs/run-1:cancel", code: http.StatusOK, body: "run-1"},
		{path: "/runs/run-1:wrong", code: http.StatusNotFound},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, test.path, nil))
		if response.Code != test.code || response.Body.String() != test.body {
			t.Fatalf("%s: response = %d %q", test.path, response.Code, response.Body.String())
		}
	}
}
