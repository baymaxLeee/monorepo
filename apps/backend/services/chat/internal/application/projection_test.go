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
		ID: "chat-conversation", State: ConversationReady, Operation: ConversationCreate,
		RuntimeThreadID: "runtime-thread", CreateRequestID: "request-1234",
		UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", Title: "Product title",
		CreatedAt: time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC),
	}
}

func TestProjectRuntimeValue(t *testing.T) {
	product := testConversation()
	input := map[string]any{
		"session_id": product.RuntimeThreadID,
		"nested":     map[string]any{"sessionId": product.RuntimeThreadID, "url": "/api/chat-server/sessions/runtime-thread/files/file/content"},
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

func TestRuntimeRunBodyRejectsMismatchedConversationAndUsesStoredPluginSelections(t *testing.T) {
	product := testConversation()
	product.PluginSelections = []ConversationPluginSelection{{
		PluginID: "canvas@platform",
		Bindings: map[string]string{"project_id": "project", "canvas_id": "canvas"},
	}}
	if _, err := RuntimeRunBody(product, map[string]any{"id": "another"}); err == nil {
		t.Fatal("mismatched conversation id was accepted")
	}
	got, err := RuntimeRunBody(product, map[string]any{
		"request_id":         "retry",
		"host_context":       map[string]any{"project_id": "untrusted"},
		"plugin_activations": []any{map[string]any{"plugin_id": "attacker@external"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"id": product.RuntimeThreadID, "request_id": "retry", "generate_title": false,
		"plugin_activations": product.PluginSelections,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("run body = %#v, want %#v", got, want)
	}

	product.Title = "新对话"
	got, err = RuntimeRunBody(product, map[string]any{"request_id": "first", "generate_title": false})
	if err != nil {
		t.Fatal(err)
	}
	if got["generate_title"] != true {
		t.Fatalf("new conversation generate_title = %#v, want true", got["generate_title"])
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

func TestRuntimeRunBodyResolvesUserAttachmentInMappedSession(t *testing.T) {
	product := testConversation()
	submit := func(raw string) (map[string]any, error) {
		part := map[string]any{"type": "file", "url": raw}
		return RuntimeRunBody(product, map[string]any{"message": map[string]any{"role": "user", "parts": []any{part}}})
	}
	result, err := submit("/api/chat-server/conversations/chat-conversation/files/upload/content")
	if err != nil {
		t.Fatal(err)
	}
	got := result["message"].(map[string]any)["parts"].([]any)[0].(map[string]any)["url"]
	if got != "/api/chat-server/sessions/runtime-thread/files/upload/content" {
		t.Fatalf("attachment URL = %v", got)
	}
	for _, raw := range []string{
		"/api/chat-server/conversations/other/files/upload/content",
		"/api/chat-server/conversations/chat-conversation/documents/doc/content",
		"/arbitrary?file_id=upload",
	} {
		if _, err := submit(raw); err == nil {
			t.Fatalf("accepted attachment %q", raw)
		}
	}
}
