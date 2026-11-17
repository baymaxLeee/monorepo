package providerclient

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	arkmodel "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCreateResponsesCallsConfiguredTextProviderDirectly(t *testing.T) {
	var received map[string]any
	provider := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v3/responses" {
			t.Errorf("unexpected provider path: %s", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Errorf("decode provider request: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"id": "response-1", "object": "response", "status": "completed", "output": []any{},
		})
	}))
	defer provider.Close()

	directory := providerDirectoryServer(t, admin.Provider{
		ID: "provider-text", ProviderKind: "chat", Model: "text-upstream",
		BaseURL: provider.URL + "/api/v3/responses", APIKey: "secret", IsEnabled: true,
	}, false)
	client := New(directory)
	_, err := client.CreateResponses(requestContext("provider-text"), &responses.ResponsesRequest{Model: "provider-text"})
	if err != nil {
		t.Fatalf("CreateResponses returned error: %v", err)
	}
	if received["model"] != "text-upstream" {
		t.Fatalf("provider model was not substituted: %#v", received["model"])
	}
	if _, exists := received["tools"]; exists {
		t.Fatalf("plain Canvas text generation must not inject agent tools: %#v", received["tools"])
	}
}

func TestGenerateImagesResolvesAdminProviderAndNormalizesResourceURL(t *testing.T) {
	var received map[string]any
	ark := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v3/images/generations" {
			t.Errorf("unexpected Ark path: %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("unexpected authorization header: %q", request.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode Ark request: %v", err)
		}
		writer.Header().Set(HeaderProviderRequestID, "request-image")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"data": []map[string]any{{"url": "https://cdn.example.com/generated.png"}},
		})
	}))
	defer ark.Close()

	directory := providerDirectoryServer(t, admin.Provider{
		ID: "provider-image", ProviderKind: "image", Model: "seedream-upstream",
		BaseURL: ark.URL + "/api/v3/images/generations", APIKey: "secret", IsEnabled: true,
	}, false)
	client := New(directory)
	response, err := client.GenerateImages(requestContext("provider-image"), arkmodel.GenerateImagesRequest{
		Model: "provider-image", Prompt: "draw a cat",
	})
	if err != nil {
		t.Fatalf("GenerateImages returned error: %v", err)
	}
	if received["model"] != "seedream-upstream" {
		t.Fatalf("provider model was not substituted: %#v", received["model"])
	}
	if response.Header().Get(HeaderProviderRequestID) != "request-image" {
		t.Fatalf("request id was not propagated: %#v", response.Header())
	}
}

func TestVideoTaskPollUsesTaskCredentialsAfterProviderDisabled(t *testing.T) {
	ark := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v3/contents/generations/tasks/task-1" {
			t.Errorf("unexpected Ark path: %s", request.URL.Path)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"id": "task-1", "status": arkmodel.StatusRunning, "content": map[string]any{},
		})
	}))
	defer ark.Close()

	directory := providerDirectoryServer(t, admin.Provider{
		ID: "provider-video", ProviderKind: "video", Model: "seedance-upstream",
		BaseURL: ark.URL + "/api/v3/contents/generations/tasks", APIKey: "secret", IsEnabled: false,
	}, true)
	client := New(directory)
	response, err := client.GetContentGenerationTask(requestContext("provider-video"), arkmodel.GetContentGenerationTaskRequest{ID: "task-1"})
	if err != nil {
		t.Fatalf("GetContentGenerationTask returned error: %v", err)
	}
	if response.ID != "task-1" || response.Status != arkmodel.StatusRunning {
		t.Fatalf("unexpected task response: %#v", response)
	}
}

func TestCreateVideoTaskResolvesProviderAndNormalizesResourceURL(t *testing.T) {
	var received map[string]any
	ark := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v3/contents/generations/tasks" {
			t.Errorf("unexpected Ark path: %s", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode Ark request: %v", err)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"id": "task-created"})
	}))
	defer ark.Close()

	directory := providerDirectoryServer(t, admin.Provider{
		ID: "provider-video", ProviderKind: "video", Model: "seedance-upstream",
		BaseURL: ark.URL + "/api/v3/contents/generations/tasks", APIKey: "secret", IsEnabled: true,
	}, false)
	client := New(directory)
	duration := int64(5)
	response, err := client.CreateContentGenerationTask(requestContext("provider-video"), arkmodel.CreateContentGenerationTaskRequest{
		Model: "provider-video", Duration: &duration,
		ExtraBody: arkmodel.ExtraBody{"content": []map[string]any{{"type": "text", "text": "a short film"}}},
	})
	if err != nil {
		t.Fatalf("CreateContentGenerationTask returned error: %v", err)
	}
	if response.ID != "task-created" {
		t.Fatalf("unexpected created task: %#v", response)
	}
	if received["model"] != "seedance-upstream" || received["duration"] != float64(5) {
		t.Fatalf("unexpected video request: %#v", received)
	}
	if _, ok := received["content"]; !ok {
		t.Fatalf("video content was not forwarded: %#v", received)
	}
}

func TestGenerateImagesRejectsProviderKindMismatchBeforeArkRequest(t *testing.T) {
	directory := providerDirectoryServer(t, admin.Provider{
		ID: "provider-video", ProviderKind: "video", Model: "seedance-upstream",
		BaseURL: "https://ark.example.com/api/v3", APIKey: "secret", IsEnabled: true,
	}, false)
	client := New(directory)
	_, err := client.GenerateImages(requestContext("provider-video"), arkmodel.GenerateImagesRequest{Model: "provider-video", Prompt: "draw"})
	if err == nil {
		t.Fatal("expected provider kind mismatch")
	}
	if RequestAttempted(err) {
		t.Fatalf("provider resolution failure must not be recorded as an attempted paid call: %v", err)
	}
}

func TestArkAPIRoot(t *testing.T) {
	for input, expected := range map[string]string{
		"https://ark.example.com/api/v3":                             "https://ark.example.com/api/v3",
		"https://ark.example.com/api/v3/":                            "https://ark.example.com/api/v3",
		"https://ark.example.com/api/v3/images/generations":          "https://ark.example.com/api/v3",
		"https://ark.example.com/api/v3/contents/generations/tasks/": "https://ark.example.com/api/v3",
		"https://ark.example.com/api/v3/responses":                   "https://ark.example.com/api/v3",
	} {
		if actual := arkAPIRoot(input); actual != expected {
			t.Errorf("arkAPIRoot(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func requestContext(providerID string) context.Context {
	ctx := WithTraceIdentity(context.Background(), "tenant-1", "user-1")
	ctx = WithWorkspaceID(ctx, "workspace-1")
	ctx = WithProjectID(ctx, "project-1")
	return WithProviderID(ctx, providerID)
}

type providerServer struct {
	adminv1.UnimplementedProviderServiceServer
	provider        *adminv1.ModelProvider
	taskCredentials bool
	t               *testing.T
}

func (server *providerServer) GetProvider(_ context.Context, request *adminv1.GetProviderRequest) (*adminv1.GetProviderResponse, error) {
	if server.taskCredentials {
		server.t.Error("expected task-credential lookup")
	}
	server.assertScope(request.GetActor().GetTenantId(), request.GetActor().GetWorkspaceId())
	return &adminv1.GetProviderResponse{Provider: server.provider}, nil
}

func (server *providerServer) GetTaskProvider(_ context.Context, request *adminv1.GetTaskProviderRequest) (*adminv1.GetTaskProviderResponse, error) {
	if !server.taskCredentials {
		server.t.Error("unexpected task-credential lookup")
	}
	server.assertScope(request.GetActor().GetTenantId(), request.GetActor().GetWorkspaceId())
	return &adminv1.GetTaskProviderResponse{Provider: server.provider}, nil
}

func (server *providerServer) assertScope(tenantID, workspaceID string) {
	if tenantID != "tenant-1" || workspaceID != "workspace-1" {
		server.t.Errorf("unexpected Admin scope: %s/%s", tenantID, workspaceID)
	}
}

func providerDirectoryServer(t *testing.T, provider admin.Provider, taskCredentials bool) *admin.Directory {
	t.Helper()
	extra, _ := structpb.NewStruct(provider.ExtraBody)
	implementation := &providerServer{t: t, taskCredentials: taskCredentials, provider: &adminv1.ModelProvider{Id: provider.ID, Name: provider.Name, Model: provider.Model, ProviderKind: providerKindProto(provider.ProviderKind), BaseUrl: provider.BaseURL, ApiKey: provider.APIKey, ExtraBody: extra, ContextWindow: int32(provider.ContextWindow), MaxOutputTokens: int32(provider.MaxOutputTokens), SupportsImageInput: provider.SupportsImageInput, IsDefault: provider.IsDefault, IsEnabled: provider.IsEnabled}}
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	adminv1.RegisterProviderServiceServer(server, implementation)
	go func() { _ = server.Serve(listener) }()
	connection, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatalf("grpc.NewClient() error = %v", err)
	}
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })
	return admin.New(connection)
}

func providerKindProto(value string) adminv1.ProviderKind {
	switch value {
	case "chat":
		return adminv1.ProviderKind_PROVIDER_KIND_CHAT
	case "image":
		return adminv1.ProviderKind_PROVIDER_KIND_IMAGE
	case "video":
		return adminv1.ProviderKind_PROVIDER_KIND_VIDEO
	default:
		return adminv1.ProviderKind_PROVIDER_KIND_UNSPECIFIED
	}
}
