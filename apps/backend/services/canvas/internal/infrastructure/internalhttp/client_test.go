package internalhttp

import (
	"net/http"
	"testing"
)

func TestResponseErrorPreservesStructuredProblemAndTrace(t *testing.T) {
	t.Parallel()
	response := &http.Response{StatusCode: http.StatusConflict, Header: http.Header{"X-Trace-Id": []string{"trace-1"}}}
	err := ResponseError("admin", "reserve", response, []byte(`{"code":"conflict","detail":"already reserved","details":{"reservation":"r1"}}`))
	transportErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T", err)
	}
	if transportErr.Code != "conflict" || transportErr.Detail != "already reserved" || transportErr.TraceID != "trace-1" {
		t.Fatalf("transport error = %#v", transportErr)
	}
	if transportErr.Details["reservation"] != "r1" {
		t.Fatalf("details = %#v", transportErr.Details)
	}
}
