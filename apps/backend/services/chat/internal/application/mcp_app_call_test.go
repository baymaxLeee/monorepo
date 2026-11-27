package application

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type appCallResolver struct {
	titleCapabilityResolverStub
	selected []ConversationPluginSelection
	revoked  bool
}

func (r *appCallResolver) ResolvePlugins(_ context.Context, scope AuthContext, selections []ConversationPluginSelection) (map[string]any, error) {
	if scope.UserID != "user" || scope.WorkspaceID != "workspace" {
		return nil, errors.New("wrong scope")
	}
	r.selected = selections
	if r.revoked {
		return nil, errors.New("revoked")
	}
	return map[string]any{"snapshotId": "current"}, nil
}

type appCallRuntime struct {
	body  map[string]any
	calls int
}

func (r *appCallRuntime) Do(_ context.Context, request RuntimeRequest) (*http.Response, error) {
	r.calls++
	if err := json.NewDecoder(request.Body).Decode(&r.body); err != nil {
		return nil, err
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"structuredContent":{"session_id":"upstream-field"}}`))}, nil
}
func TestMCPAppCallUsesCurrentProductScopeAndPreservesNativeResult(t *testing.T) {
	repo := &titleRepositoryStub{conversation: Conversation{ID: "conversation", RuntimeThreadID: "thread", State: ConversationReady, PluginSelections: []ConversationPluginSelection{{PluginID: "docs@market"}, {PluginID: "other@market"}}}}
	resolver := &appCallResolver{}
	runtime := &appCallRuntime{}
	service := NewService(repo, runtime, resolver)
	call := func(body string) (*http.Response, error) {
		return service.ProxyConversation(t.Context(), AuthContext{UserID: "user", WorkspaceID: "workspace"}, http.Header{}, http.MethodPost, "conversation", "/mcp-apps/call", "", strings.NewReader(body))
	}
	input := `{"plugin_id":"docs@market","tool_call_id":"c","name":"search","arguments":{}}`
	response, err := call(input)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	plugins, _ := runtime.body["plugins"].(map[string]any)
	if !strings.Contains(string(data), "session_id") || len(resolver.selected) != 1 || resolver.selected[0].PluginID != "docs@market" || plugins["snapshotId"] != "current" {
		t.Fatal("incorrect capability or result projection")
	}
	resolver.revoked = true
	for _, body := range []string{input, strings.Replace(input, "docs@market", "unknown@market", 1), strings.Replace(input, `"arguments":{}`, `"arguments":{},"plugins":{}`, 1)} {
		if _, err = call(body); err == nil {
			t.Fatal("unauthorized request accepted")
		}
	}
	if runtime.calls != 1 {
		t.Fatal("unauthorized request reached Runtime")
	}
}
