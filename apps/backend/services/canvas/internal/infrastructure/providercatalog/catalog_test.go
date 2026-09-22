package modelcatalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
)

func TestResolveUsesExplicitWorkspaceOutsideRequestContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.URL.Query().Get("tenant_id"); got != "tenant-1" {
			t.Fatalf("unexpected tenant_id: %q", got)
		}
		if got := request.URL.Query().Get("workspace_id"); got != "workspace-1" {
			t.Fatalf("unexpected workspace_id: %q", got)
		}
		_ = json.NewEncoder(writer).Encode(admin.Provider{
			ID: "chat-provider", Name: "Chat", Model: "chat-model", ProviderKind: "chat", IsEnabled: true,
		})
	}))
	defer server.Close()

	workspaceID := "workspace-1"
	catalog := New(&admin.Directory{URL: server.URL})
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
