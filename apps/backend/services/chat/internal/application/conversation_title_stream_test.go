package application

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type titleRepositoryStub struct {
	conversation Conversation
	updates      []string
}

func (*titleRepositoryStub) Ping(context.Context) error { return nil }
func (*titleRepositoryStub) Close()                     {}
func (*titleRepositoryStub) Create(context.Context, AuthContext, string, CreateConversationInput) (Conversation, error) {
	return Conversation{}, nil
}
func (*titleRepositoryStub) List(context.Context, AuthContext) ([]Conversation, error) {
	return nil, nil
}
func (stub *titleRepositoryStub) Get(context.Context, AuthContext, string) (*Conversation, error) {
	value := stub.conversation
	return &value, nil
}
func (*titleRepositoryStub) UpdateTitle(context.Context, AuthContext, string, string) (*Conversation, error) {
	return nil, nil
}
func (stub *titleRepositoryStub) UpdateTitleIfDefault(_ context.Context, _ AuthContext, _ string, title string) (*Conversation, error) {
	if !isAutoNamableTitle(stub.conversation.Title) {
		return nil, nil
	}
	stub.conversation.Title = title
	stub.updates = append(stub.updates, title)
	value := stub.conversation
	return &value, nil
}
func (*titleRepositoryStub) Delete(context.Context, AuthContext, string) (*Conversation, error) {
	return nil, nil
}

type titleRuntimeStub struct {
	response *http.Response
}

func (stub titleRuntimeStub) Do(context.Context, RuntimeRequest) (*http.Response, error) {
	return stub.response, nil
}

type chunkedReadCloser struct {
	chunks []string
}

func (reader *chunkedReadCloser) Read(target []byte) (int, error) {
	if len(reader.chunks) == 0 {
		return 0, io.EOF
	}
	chunk := reader.chunks[0]
	reader.chunks = reader.chunks[1:]
	return copy(target, chunk), nil
}

func (*chunkedReadCloser) Close() error { return nil }

func TestProxyConversationPersistsFirstStreamedTitleWithoutChangingSSE(t *testing.T) {
	payloadChunks := []string{
		"data: {\"type\":\"text-delta\",\"delta\":\"hello\"}\n\n",
		"data: {\"type\":\"data-conversation-",
		"title\",\"data\":{\"title\":\"迁移遗漏修复\"},\"transient\":true}\r\n\r\n",
		"data: {\"type\":\"data-conversation-title\",\"data\":{\"title\":\"不应重复\"},\"transient\":true}\n\n",
		"data: [DONE]\n\n",
	}
	payload := strings.Join(payloadChunks, "")
	repository := &titleRepositoryStub{conversation: Conversation{
		ID: "conversation", RuntimeSessionID: "session", UserID: "user", TenantID: "tenant", WorkspaceID: "workspace",
		Title: "新对话", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}}
	service := NewService(repository, titleRuntimeStub{response: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body:       &chunkedReadCloser{chunks: append([]string(nil), payloadChunks...)},
	}})

	response, err := service.ProxyConversation(
		context.Background(), AuthContext{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace"},
		make(http.Header), http.MethodGet, "conversation", "/agents/run/stream", "", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != payload {
		t.Fatalf("SSE bytes changed: %q", string(got))
	}
	if len(repository.updates) != 1 || repository.updates[0] != "迁移遗漏修复" {
		t.Fatalf("title updates = %#v, want one generated title", repository.updates)
	}
}
