package modelcatalog

import (
	"context"
	"net"
	"testing"

	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type providerServer struct {
	adminv1.UnimplementedProviderServiceServer
	t *testing.T
}

func (server *providerServer) GetProvider(_ context.Context, request *adminv1.GetProviderRequest) (*adminv1.GetProviderResponse, error) {
	if request.GetActor().GetTenantId() != "tenant-1" || request.GetActor().GetWorkspaceId() != "workspace-1" {
		server.t.Fatalf("unexpected scope: %#v", request.GetActor())
	}
	return &adminv1.GetProviderResponse{Provider: &adminv1.ModelProvider{Id: "chat-provider", Name: "Chat", Model: "chat-model", ProviderKind: adminv1.ProviderKind_PROVIDER_KIND_CHAT, IsEnabled: true}}, nil
}

func testDirectory(t *testing.T) *admin.Directory {
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	adminv1.RegisterProviderServiceServer(server, &providerServer{t: t})
	go func() { _ = server.Serve(listener) }()
	connection, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })
	return admin.New(connection)
}

func TestResolveUsesExplicitWorkspaceOutsideRequestContext(t *testing.T) {
	workspaceID := "workspace-1"
	catalog := New(testDirectory(t))
	resolved, err := catalog.Resolve(context.Background(), applicationmodel.Actor{
		TenantID: "tenant-1", WorkspaceID: &workspaceID, UserID: "user-1",
	}, []applicationmodel.Requirement{{Capability: applicationmodel.CapabilityStoryboardInference, ModelID: "chat-provider"}})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if len(resolved) != 1 || resolved[0].Selection.ModelID != "chat-provider" {
		t.Fatalf("unexpected resolution: %#v", resolved)
	}
}

func TestProviderCapabilitiesComeFromConfiguredUpstreamModel(t *testing.T) {
	video := videoCapabilities("doubao-seedance-2-5-pro-250922")
	if video.DurationMinSeconds != 4 || video.DurationMaxSeconds != 30 {
		t.Fatalf("unexpected Seedance 2.5 duration range: %d..%d", video.DurationMinSeconds, video.DurationMaxSeconds)
	}
	if video.MaxImageReferences == nil || *video.MaxImageReferences != 9 ||
		video.MaxVideoReferences == nil || *video.MaxVideoReferences != 3 ||
		video.MaxAudioReferences == nil || *video.MaxAudioReferences != 3 {
		t.Fatalf("unexpected Seedance 2.5 reference limits: %#v", video)
	}

	image := imageCapabilities("doubao-seedream-4-0-250828")
	if image.MaxInputReferences == nil || *image.MaxInputReferences != 10 {
		t.Fatalf("unexpected Seedream reference limit: %#v", image.MaxInputReferences)
	}
}

func TestUnknownModelsUseConservativeCapabilities(t *testing.T) {
	video := videoCapabilities("custom-video-model")
	if video.DurationMinSeconds != 5 || video.DurationMaxSeconds != 10 {
		t.Fatalf("unexpected fallback duration range: %d..%d", video.DurationMinSeconds, video.DurationMaxSeconds)
	}
	if video.MaxImageReferences == nil || *video.MaxImageReferences != 0 {
		t.Fatalf("unknown video model must not advertise image references: %#v", video.MaxImageReferences)
	}
	image := imageCapabilities("custom-image-model")
	if image.MaxInputReferences == nil || *image.MaxInputReferences != 0 {
		t.Fatalf("unknown image model must not advertise image references: %#v", image.MaxInputReferences)
	}
}
