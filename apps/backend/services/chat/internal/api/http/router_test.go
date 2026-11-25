package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/chat/internal/application"
)

type repositoryStub struct {
	conversation application.Conversation
	memories     []application.UserMemory
}

func (repositoryStub) Ping(context.Context) error { return nil }
func (repositoryStub) Close()                     {}
func (repositoryStub) Reserve(context.Context, application.AuthContext, application.ConversationIntent) (application.Conversation, error) {
	return application.Conversation{}, nil
}
func (repositoryStub) BindRuntimeThread(context.Context, application.AuthContext, string, string) (application.Conversation, error) {
	return application.Conversation{}, nil
}
func (repositoryStub) RecordSagaFailure(context.Context, application.AuthContext, string, application.ConversationState, error) error {
	return nil
}
func (repositoryStub) List(context.Context, application.AuthContext) ([]application.Conversation, error) {
	return []application.Conversation{}, nil
}
func (stub repositoryStub) Get(_ context.Context, scope application.AuthContext, id string) (*application.Conversation, error) {
	if id != stub.conversation.ID || scope.UserID != stub.conversation.UserID || scope.TenantID != stub.conversation.TenantID || scope.WorkspaceID != stub.conversation.WorkspaceID {
		return nil, nil
	}
	value := stub.conversation
	return &value, nil
}
func (repositoryStub) UpdateTitle(context.Context, application.AuthContext, string, string) (*application.Conversation, error) {
	return nil, nil
}
func (repositoryStub) UpdateTitleIfDefault(context.Context, application.AuthContext, string, string) (*application.Conversation, error) {
	return nil, nil
}
func (stub repositoryStub) ListActiveMemories(context.Context, application.AuthContext) ([]application.UserMemory, error) {
	return stub.memories, nil
}
func (repositoryStub) ListMemoryCandidates(context.Context, application.AuthContext) ([]application.MemoryCandidate, error) {
	return []application.MemoryCandidate{}, nil
}
func (repositoryStub) ApproveMemoryCandidate(context.Context, application.AuthContext, string) (*application.UserMemory, error) {
	return nil, nil
}
func (repositoryStub) RejectMemoryCandidate(context.Context, application.AuthContext, string) (bool, error) {
	return false, nil
}
func (repositoryStub) UpdateMemoryCandidate(context.Context, application.AuthContext, string, *application.MemoryCategory, *string) (*application.MemoryCandidate, error) {
	return nil, nil
}
func (repositoryStub) DeleteMemory(context.Context, application.AuthContext, string) (bool, error) {
	return false, nil
}
func (repositoryStub) BeginDelete(context.Context, application.AuthContext, string) (*application.Conversation, error) {
	return nil, nil
}
func (repositoryStub) CompleteDelete(context.Context, application.AuthContext, string, string) error {
	return nil
}

type runtimeStub struct {
	response *http.Response
	request  application.RuntimeRequest
}

func (stub *runtimeStub) Do(_ context.Context, request application.RuntimeRequest) (*http.Response, error) {
	stub.request = request
	return stub.response, nil
}

type capabilityResolverStub struct{}

func (capabilityResolverStub) ResolveTurn(context.Context, application.AuthContext, *string, []application.ConversationPluginSelection) (application.TurnCapabilities, error) {
	return application.TurnCapabilities{}, nil
}

func (capabilityResolverStub) ResolveProvider(context.Context, application.AuthContext, *string) (application.RuntimeProviderCapability, error) {
	return application.RuntimeProviderCapability{ID: "provider-1", Model: "model-1"}, nil
}

func (capabilityResolverStub) ResolvePlugins(context.Context, application.AuthContext, []application.ConversationPluginSelection) (map[string]any, error) {
	return map[string]any{"snapshotId": "snapshot-1", "plugins": []any{}}, nil
}

func testRouter(runtimeResponse *http.Response) (http.Handler, *runtimeStub) {
	conversation := application.Conversation{
		ID: "chat-conversation", State: application.ConversationReady, Operation: application.ConversationCreate,
		RuntimeThreadID: "runtime-thread", UserID: "user", TenantID: "tenant", WorkspaceID: "workspace",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	runtime := &runtimeStub{response: runtimeResponse}
	handler := New(application.NewService(repositoryStub{conversation: conversation}, runtime, capabilityResolverStub{}))
	for index := 0; index < 100; index++ {
		request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code == http.StatusOK {
			break
		}
		time.Sleep(time.Millisecond)
	}
	return handler, runtime
}

func scopedRequest(method, target string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, target, body)
	request.Header.Set("X-Auth-User-ID", "user")
	request.Header.Set("X-Auth-Tenant-ID", "tenant")
	request.Header.Set("X-Auth-Workspace-ID", "workspace")
	request.Header.Set("Content-Type", "application/json")
	return request
}

func TestMissingGatewayScopeIsRejected(t *testing.T) {
	handler, _ := testRouter(&http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: http.NoBody})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/conversations", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", response.Code, response.Body.String())
	}
}

func TestProductMemoryIsOwnedByChatAndScopedBeforeRuntimeProjection(t *testing.T) {
	conversation := application.Conversation{
		ID: "chat-conversation", State: application.ConversationReady, Operation: application.ConversationCreate,
		RuntimeThreadID: "runtime-thread", UserID: "user", TenantID: "tenant", WorkspaceID: "workspace",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	repository := repositoryStub{conversation: conversation, memories: []application.UserMemory{{
		ID: "memory", Category: application.MemoryPreference, Content: "Prefer concise answers.", Confidence: 100,
	}}}
	handler := New(application.NewService(repository, &runtimeStub{}, capabilityResolverStub{}))
	for index := 0; index < 100; index++ {
		ready := httptest.NewRecorder()
		handler.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		if ready.Code == http.StatusOK {
			break
		}
		time.Sleep(time.Millisecond)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, scopedRequest(http.MethodGet, "/memories", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Memories []application.UserMemory `json:"memories"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Memories) != 1 || body.Memories[0].ID != "memory" {
		t.Fatalf("memories = %#v", body.Memories)
	}
}

func TestConversationProxyPreservesSSEBytesAndMapsRuntimePath(t *testing.T) {
	payload := "data: {\"type\":\"text-delta\",\"delta\":\"runtime-session\"}\n\n"
	handler, runtime := testRouter(&http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}, "X-Runtime-Stream": []string{"yes"}},
		Body:       io.NopCloser(strings.NewReader(payload)),
	})
	request := scopedRequest(http.MethodGet, "/conversations/chat-conversation/stream", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != payload {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Runtime-Stream") != "yes" {
		t.Fatalf("runtime header = %q", response.Header().Get("X-Runtime-Stream"))
	}
	if runtime.request.Path != "/v1/sessions/runtime-thread/stream" {
		t.Fatalf("runtime path = %q", runtime.request.Path)
	}
}

func TestActiveTurnConflictStatusHeadersAndBodyArePreserved(t *testing.T) {
	handler, _ := testRouter(&http.Response{
		StatusCode: http.StatusConflict,
		Header:     http.Header{"Content-Type": []string{"application/json"}, "Retry-After": []string{"2"}},
		Body:       io.NopCloser(strings.NewReader(`{"code":"active_run_exists","message":"this session already has an active run","details":{"run_id":"turn"}}`)),
	})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, scopedRequest(http.MethodGet, "/conversations/chat-conversation/context", nil))
	if response.Code != http.StatusConflict || response.Header().Get("Retry-After") != "2" {
		t.Fatalf("response = %d retry=%q", response.Code, response.Header().Get("Retry-After"))
	}
	var problem struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details struct {
			RunID string `json:"run_id"`
		} `json:"details"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode body %q: %v", response.Body.String(), err)
	}
	if problem.Code != "active_run_exists" || problem.Message != "this session already has an active run" || problem.Details.RunID != "turn" {
		t.Fatalf("problem = %#v", problem)
	}
}

func TestCreateInputRejectsSecretBearingOrEndpointPluginFields(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/conversations", strings.NewReader(`{
		"request_id":"request-1234",
		"plugin_selections":[{"plugin_id":"external@marketplace","url":"https://example.com/mcp"}]
	}`))
	request.Header.Set("Content-Type", "application/json")
	if _, err := decodeCreateInput(request); err == nil {
		t.Fatal("plugin endpoint field was accepted from the renderer")
	}
}

func TestLocalInferenceDeliversFirstRecordBeforeStreamEnds(t *testing.T) {
	reader, upstream := io.Pipe()
	handler, runtime := testRouter(&http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/x-ndjson; charset=utf-8"}},
		Body:       reader,
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	defer upstream.Close()
	const first = "{\"type\":\"text-start\",\"id\":\"answer\"}\n"
	go func() { _, _ = io.WriteString(upstream, first) }()
	req, err := http.NewRequest(http.MethodPost, server.URL+"/local-inference/stream", strings.NewReader(`{"providerId":"provider-1","messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header = scopedRequest(http.MethodPost, "/", nil).Header
	client := server.Client()
	client.Timeout = 2 * time.Second
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	got := make([]byte, len(first))
	if _, err := io.ReadFull(response.Body, got); err != nil || string(got) != first {
		t.Fatalf("first live record = %q, err = %v", got, err)
	}
	if runtime.request.Method != http.MethodPost || runtime.request.Path != "/local-inference/stream" {
		t.Fatalf("runtime request = %s %s", runtime.request.Method, runtime.request.Path)
	}
	forwarded, err := io.ReadAll(runtime.request.Body)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"provider":{"id":"provider-1","name":"","model":"model-1","baseUrl":"","apiKey":"","extraBody":null,"contextWindow":0,"maxOutputTokens":0,"supportsImageInput":false},"request":{"messages":[],"providerId":"provider-1"}}`
	if string(forwarded) != want {
		t.Fatalf("runtime request body = %s", forwarded)
	}
}
