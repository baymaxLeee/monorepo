package artifact

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestValidatePublicRemoteURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "loopback literal", raw: "http://127.0.0.1/media.png"},
		{name: "link local metadata", raw: "http://169.254.169.254/latest/meta-data"},
		{name: "internal DNS name", raw: "https://knowledge.cluster.local/media.png"},
		{name: "URL credentials", raw: "https://user:password@example.com/media.png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate, err := url.Parse(test.raw)
			if err != nil {
				t.Fatalf("parse test URL: %v", err)
			}
			if validatePublicRemoteURL(candidate) == nil {
				t.Fatalf("validatePublicRemoteURL(%q) succeeded, want rejection", test.raw)
			}
		})
	}
}

func TestStorePersistRemote(t *testing.T) {
	t.Run("rejects private source before downloading", func(t *testing.T) {
		requests := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			requests++
			_, _ = writer.Write([]byte("must not be downloaded"))
		}))
		defer server.Close()

		store := New(&storage.Client{URL: server.URL}, "").(*Store)
		_, _, err := store.persistRemote(
			context.Background(), "tenant-1", nil, "project-1", server.URL+"/generated.png",
		)
		if err == nil {
			t.Fatal("expected private generated-media URL to be rejected")
		}
		if requests != 0 {
			t.Fatalf("private server received %d requests, want 0", requests)
		}
	})

	t.Run("rejects oversized source before upload", func(t *testing.T) {
		storageRequests := 0
		storageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			storageRequests++
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"artifact_id":"unexpected","size":0,"sha256":""}`))
		}))
		defer storageServer.Close()

		originalClient := generatedMediaHTTPClient
		generatedMediaHTTPClient = &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode:    http.StatusOK,
				Header:        make(http.Header),
				Body:          io.NopCloser(strings.NewReader("")),
				ContentLength: 512*1024*1024 + 1,
			}, nil
		})}
		t.Cleanup(func() { generatedMediaHTTPClient = originalClient })

		store := New(&storage.Client{URL: storageServer.URL}, "").(*Store)
		_, _, err := store.persistRemote(
			context.Background(), "tenant-1", nil, "project-1", "https://media.example.com/generated.mp4",
		)
		if err == nil {
			t.Fatal("expected oversized generated media to be rejected")
		}
		if storageRequests != 0 {
			t.Fatalf("storage received %d requests, want 0", storageRequests)
		}
	})
}

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
