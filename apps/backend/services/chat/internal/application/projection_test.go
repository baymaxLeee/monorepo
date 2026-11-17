package application

import (
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func testConversation() Conversation {
	return Conversation{
		ID: "chat-conversation", RuntimeSessionID: "runtime-session", CreateRequestID: "request-1234",
		UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", Title: "Product title",
		CreatedAt: time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC),
	}
}

func TestProjectRuntimeValue(t *testing.T) {
	product := testConversation()
	input := map[string]any{
		"session_id": product.RuntimeSessionID,
		"nested":     map[string]any{"sessionId": product.RuntimeSessionID, "url": "/api/chat-server/sessions/runtime-session/files/file/content"},
		"context":    map[string]any{"id": "session", "tokens": float64(42)},
	}
	want := map[string]any{
		"conversation_id": product.ID,
		"nested":          map[string]any{"conversationId": product.ID, "url": "/api/chat-server/conversations/chat-conversation/files/file/content"},
		"context":         map[string]any{"id": "conversation", "tokens": float64(42)},
	}
	if got := ProjectRuntimeValue(product, input); !reflect.DeepEqual(got, want) {
		t.Fatalf("projection = %#v, want %#v", got, want)
	}
}

func TestRuntimeRunBodyRejectsMismatchedConversationAndBindsCanvas(t *testing.T) {
	project, canvas := "project", "canvas"
	product := testConversation()
	product.ProjectID, product.CanvasID = &project, &canvas
	if _, err := RuntimeRunBody(product, map[string]any{"id": "another"}); err == nil {
		t.Fatal("mismatched conversation id was accepted")
	}
	got, err := RuntimeRunBody(product, map[string]any{"request_id": "retry", "host_context": map[string]any{"project_id": "untrusted"}})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"id": product.RuntimeSessionID, "request_id": "retry", "host_context": map[string]any{"project_id": project, "canvas_id": canvas}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("run body = %#v, want %#v", got, want)
	}
}

func TestProjectRuntimeResponseLeavesSSEBytesUntouched(t *testing.T) {
	payload := "data: {\"type\":\"text-delta\",\"delta\":\"runtime-session\"}\n\n"
	response := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       io.NopCloser(strings.NewReader(payload)),
	}
	got, err := ProjectRuntimeResponse(testConversation(), response)
	if err != nil {
		t.Fatal(err)
	}
	bytes, _ := io.ReadAll(got.Body)
	if string(bytes) != payload {
		t.Fatalf("SSE payload changed: %q", string(bytes))
	}
}

func TestJSONNumberProjectionKeepsNumericEncoding(t *testing.T) {
	var input any
	decoder := json.NewDecoder(strings.NewReader(`{"tokens":42,"id":"session"}`))
	decoder.UseNumber()
	if err := decoder.Decode(&input); err != nil {
		t.Fatal(err)
	}
	got := ProjectRuntimeValue(testConversation(), input).(map[string]any)
	if got["id"] != "conversation" {
		t.Fatalf("context id = %v", got["id"])
	}
}
