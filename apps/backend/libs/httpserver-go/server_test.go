package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTraceContextUsesW3CTraceID(t *testing.T) {
	engine := gin.New()
	engine.Use(TraceContext())
	engine.GET("/items/:id", func(c *gin.Context) {
		if got := c.Param("id"); got != "item-1" {
			t.Fatalf("path value = %q", got)
		}
		_, _ = io.WriteString(c.Writer, TraceID(c.Request.Context()))
	})

	request := httptest.NewRequest(http.MethodGet, "/items/item-1", nil)
	request.Header.Set(HeaderTraceParent, "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if got := strings.TrimSpace(recorder.Body.String()); got != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("trace id = %q", got)
	}
	if got := recorder.Header().Get(HeaderTraceParent); got != "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" {
		t.Fatalf("response traceparent = %q", got)
	}
}

func TestRecoveryWritesJSONBeforeResponseStarts(t *testing.T) {
	engine := gin.New()
	engine.Use(TraceContext(), Recovery())
	engine.GET("/panic", func(*gin.Context) { panic("boom") })
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/panic", nil))

	if recorder.Code != http.StatusInternalServerError || !strings.Contains(recorder.Body.String(), `"code":"internal_error"`) {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestRecoveryDoesNotAppendJSONAfterStreamStarts(t *testing.T) {
	engine := gin.New()
	engine.Use(TraceContext(), Recovery())
	engine.GET("/stream", func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		_, _ = io.WriteString(c.Writer, "data: first\n\n")
		c.Writer.Flush()
		panic("boom")
	})
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/stream", nil))

	if recorder.Code != http.StatusOK || recorder.Body.String() != "data: first\n\n" {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestServerPreservesLiteralColonActionRoutes(t *testing.T) {
	server := New("test")
	server.POST("/uploads:prepare", func(c *gin.Context) {
		_, _ = io.WriteString(c.Writer, c.Request.URL.Path+"|"+strings.ReplaceAll(c.FullPath(), routeColon, ":"))
	})
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/uploads:prepare", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "/uploads:prepare|/uploads:prepare" {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestRoutePathPreservesGroupedActionRoutes(t *testing.T) {
	server := New("test")
	group := server.Group("/projects/:projectID")
	group.POST(RoutePath("/assets:batchGet"), func(c *gin.Context) {
		_, _ = io.WriteString(c.Writer, c.Param("projectID"))
	})
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/projects/project-1/assets:batchGet", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "project-1" {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
}
