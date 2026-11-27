package internalhttp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

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
		Body: strings.TrimSpace(string(body)), TraceID: traceIDFromTraceParent(response.Header.Get("traceparent")),
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

func traceIDFromTraceParent(value string) string {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) == 4 && len(parts[1]) == 32 {
		return parts[1]
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
