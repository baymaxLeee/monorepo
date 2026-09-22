package artifact

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
)

func TestProviderReferenceInlinesImageBytes(t *testing.T) {
	payload := []byte("small-image")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || !strings.HasSuffix(request.URL.Path, "/artifact-1") {
			t.Errorf("unexpected storage request: %s %s", request.Method, request.URL.Path)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		if request.Header.Get("X-Caller-Service") != "canvas" {
			t.Errorf("missing Canvas service identity")
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = writer.Write(payload)
	}))
	defer server.Close()

	store := New(&storage.Client{URL: server.URL, Token: "internal-token"}, "http://localhost:8000")
	reference, err := store.ProviderReference(context.Background(), "tenant-1", "user-1", domainasset.Asset{
		ArtifactID: "artifact-1", ArtifactNamespace: "namespace-1",
		MediaType: domainasset.MediaImage, ContentType: "image/png", SizeBytes: int64(len(payload)),
	})
	if err != nil {
		t.Fatalf("ProviderReference returned error: %v", err)
	}
	expected := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
	if reference != expected {
		t.Fatalf("ProviderReference = %q, want %q", reference, expected)
	}
}

func TestProviderReferenceRejectsMismatchedImageSize(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte("short"))
	}))
	defer server.Close()

	store := New(&storage.Client{URL: server.URL}, "http://localhost:8000")
	_, err := store.ProviderReference(context.Background(), "tenant-1", "user-1", domainasset.Asset{
		ArtifactID: "artifact-1", ArtifactNamespace: "namespace-1",
		MediaType: domainasset.MediaImage, ContentType: "image/png", SizeBytes: 100,
	})
	if err == nil {
		t.Fatal("expected image size mismatch")
	}
}
