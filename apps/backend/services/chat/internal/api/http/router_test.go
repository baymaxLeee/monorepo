package httpapi

import (
	"context"
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
}

func (repositoryStub) Ping(context.Context) error { return nil }
func (repositoryStub) Close()                     {}
func (repositoryStub) Create(context.Context, application.AuthContext, string, application.CreateConversationInput) (application.Conversation, error) {
	return application.Conversation{}, nil
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
func (repositoryStub) Delete(context.Context, application.AuthContext, string) (*application.Conversation, error) {
	return nil, nil
}

type runtimeStub struct {
	response *http.Response
	request  application.RuntimeRequest
}

func (stub *runtimeStub) Do(_ context.Context, request application.RuntimeRequest) (*http.Response, error) {
	stub.request = request
	return stub.response, nil
}

func testRouter(runtimeResponse *http.Response) (http.Handler, *runtimeStub) {
	conversation := application.Conversation{
		ID: "chat-conversation", RuntimeSessionID: "runtime-session", UserID: "user", TenantID: "tenant", WorkspaceID: "workspace",
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	runtime := &runtimeStub{response: runtimeResponse}
	handler := New(application.NewService(repositoryStub{conversation: conversation}, runtime))
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

func TestConversationProxyPreservesSSEBytesAndMapsRuntimePath(t *testing.T) {
	payload := "data: {\"type\":\"text-delta\",\"delta\":\"runtime-session\"}\n\n"
	handler, runtime := testRouter(&http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}, "X-Runtime-Stream": []string{"yes"}},
		Body:       io.NopCloser(strings.NewReader(payload)),
	})
	request := scopedRequest(http.MethodGet, "/conversations/chat-conversation/agents/run/stream?cursor=3", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != payload {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Runtime-Stream") != "yes" {
		t.Fatalf("runtime header = %q", response.Header().Get("X-Runtime-Stream"))
	}
	if runtime.request.Path != "/v1/sessions/runtime-session/agents/run/stream?cursor=3" {
		t.Fatalf("runtime path = %q", runtime.request.Path)
	}
}

func TestRuntimeErrorStatusHeadersAndBodyArePreserved(t *testing.T) {
	handler, _ := testRouter(&http.Response{
		StatusCode: http.StatusServiceUnavailable,
		Header:     http.Header{"Content-Type": []string{"application/json"}, "Retry-After": []string{"2"}},
		Body:       io.NopCloser(strings.NewReader(`{"code":"runtime_busy","message":"try later"}`)),
	})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, scopedRequest(http.MethodGet, "/conversations/chat-conversation/context", nil))
	if response.Code != http.StatusServiceUnavailable || response.Header().Get("Retry-After") != "2" {
		t.Fatalf("response = %d retry=%q", response.Code, response.Header().Get("Retry-After"))
	}
	if response.Body.String() != `{"code":"runtime_busy","message":"try later"}` {
		t.Fatalf("body = %q", response.Body.String())
	}
}
