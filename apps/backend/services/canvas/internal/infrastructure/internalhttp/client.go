package internalhttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/canvas/internal/application/requestcontext"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Client returns a bounded, traced client while preserving injected test clients.
func Client(provided *http.Client, timeout time.Duration) *http.Client {
	if provided != nil {
		clone := *provided
		if clone.Timeout == 0 {
			clone.Timeout = timeout
		}
		return &clone
	}
	return &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: timeout}
}

// Propagate adds the repository correlation id. W3C trace context is injected by otelhttp.
func Propagate(ctx context.Context, request *http.Request) error {
	if traceID, ok := requestcontext.RequestIDFromContext(ctx); ok && request.Header.Get("X-Trace-Id") == "" {
		request.Header.Set("X-Trace-Id", traceID)
	}
	return nil
}

type Error struct {
	Service   string
	Operation string
	Status    int
	Body      string
	TraceID   string
	Code      string
	Detail    string
	Details   map[string]any
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s %s returned status %d", e.Service, e.Operation, e.Status)
}

func ResponseError(service, operation string, response *http.Response, body []byte) error {
	err := &Error{
		Service: service, Operation: operation, Status: response.StatusCode,
		Body: strings.TrimSpace(string(body)), TraceID: response.Header.Get("X-Trace-Id"),
	}
	var problem struct {
		Code    string         `json:"code"`
		Detail  string         `json:"detail"`
		Message string         `json:"message"`
		Title   string         `json:"title"`
		Details map[string]any `json:"details"`
	}
	if json.Unmarshal(body, &problem) == nil {
		err.Code = problem.Code
		err.Detail = firstNonEmpty(problem.Detail, problem.Message, problem.Title)
		err.Details = problem.Details
	}
	if err.Detail == "" {
		err.Detail = firstNonEmpty(err.Body, http.StatusText(response.StatusCode))
	}
	return err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
