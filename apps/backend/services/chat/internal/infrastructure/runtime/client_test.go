package runtime

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/example/monorepo/chat/internal/application"
)

func TestClientForwardsRequestMetadataAndUsesOnlyChatIdentity(t *testing.T) {
	var captured *http.Request
	var capturedBody string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		captured = request
		body, _ := io.ReadAll(request.Body)
		capturedBody = string(body)
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	client := New(server.URL, "chat-token")
	headers := make(http.Header)
	headers.Set("X-Auth-User-ID", "user")
	headers.Set("X-Auth-Name", "User")
	headers.Set("X-Auth-Email", "user@example.com")
	headers.Set("X-Auth-Tenant-ID", "tenant")
	headers.Set("X-Auth-Workspace-ID", "workspace")
	headers.Set("X-Auth-Workspace-Role", "member")
	headers.Set("X-Auth-Roles", "user")
	headers.Set("X-Auth-Unrecognized", "untrusted")
	headers.Set("Content-Type", "application/json")
	headers.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	headers.Set("tracestate", "vendor=value")
	headers.Set("X-Trace-Id", "trace-id")
	headers.Set("X-Caller-Service", "untrusted")
	headers.Set("X-Internal-Token", "untrusted")
	response, err := client.Do(context.Background(), application.RuntimeRequest{
		Method: http.MethodPost, Path: "/v1/sessions/session/agents/run?cursor=3",
		Headers: headers,
		Body:    strings.NewReader(`{"ok":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusAccepted || captured == nil {
		t.Fatalf("response = %d, captured=%v", response.StatusCode, captured != nil)
	}
	if captured.URL.RequestURI() != "/v1/sessions/session/agents/run?cursor=3" {
		t.Fatalf("request URI = %q", captured.URL.RequestURI())
	}
	for name, want := range map[string]string{
		"X-Caller-Service": "chat", "X-Internal-Token": "chat-token", "Content-Type": "application/json",
		"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		"tracestate":  "vendor=value", "X-Trace-Id": "trace-id",
	} {
		if got := captured.Header.Get(name); got != want {
			t.Fatalf("%s = %q, want %q", name, got, want)
		}
	}
	for _, name := range []string{
		"X-Auth-User-ID",
		"X-Auth-Name",
		"X-Auth-Email",
		"X-Auth-Tenant-ID",
		"X-Auth-Workspace-ID",
		"X-Auth-Workspace-Role",
		"X-Auth-Roles",
		"X-Auth-Unrecognized",
	} {
		if got := captured.Header.Get(name); got != "" {
			t.Fatalf("%s = %q, want empty", name, got)
		}
	}
	if capturedBody != `{"ok":true}` {
		t.Fatalf("body = %q", capturedBody)
	}
}
