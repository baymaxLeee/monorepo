package internalhttp

import (
	"net/http"
	"testing"
)

func TestResponseErrorPreservesStructuredProblemAndTrace(t *testing.T) {
	t.Parallel()
	response := &http.Response{StatusCode: http.StatusConflict, Header: http.Header{"Traceparent": []string{"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}}}
	err := ResponseError("admin", "reserve", response, []byte(`{"code":"conflict","detail":"already reserved","details":{"reservation":"r1"}}`))
	transportErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T", err)
	}
	if transportErr.Code != "conflict" || transportErr.Detail != "already reserved" || transportErr.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("transport error = %#v", transportErr)
	}
	if transportErr.Details["reservation"] != "r1" {
		t.Fatalf("details = %#v", transportErr.Details)
	}
}
