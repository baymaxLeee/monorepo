package artifact

import (
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/storageclient"
	storagev1 "github.com/example/monorepo/inner-api-go/gen/storage/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type assetServer struct {
	storagev1.UnimplementedAssetServiceServer
	content []byte
	reads   int
}

func (server *assetServer) ReadContent(_ *storagev1.ReadContentRequest, stream grpc.ServerStreamingServer[storagev1.ReadContentResponse]) error {
	server.reads++
	return stream.Send(&storagev1.ReadContentResponse{Value: &storagev1.ContentChunk{Value: &storagev1.ContentChunk_Chunk{Chunk: server.content}}})
}

func newStorageClient(t *testing.T, content []byte) (*storageclient.Client, *assetServer) {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	implementation := &assetServer{content: content}
	storagev1.RegisterAssetServiceServer(server, implementation)
	go func() { _ = server.Serve(listener) }()
	connection, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })
	return storageclient.New(connection), implementation
}

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

		storage, implementation := newStorageClient(t, nil)
		store := New(storage, "").(*Store)
		_, err := store.persistRemote(
			context.Background(), "result.png", "task-1", server.URL+"/generated.png",
		)
		if err == nil {
			t.Fatal("expected private generated-media URL to be rejected")
		}
		if requests != 0 {
			t.Fatalf("private server received %d requests, want 0", requests)
		}
		if implementation.reads != 0 {
			t.Fatalf("storage received %d reads, want 0", implementation.reads)
		}
	})

	t.Run("rejects oversized source before upload", func(t *testing.T) {
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

		storage, implementation := newStorageClient(t, nil)
		store := New(storage, "").(*Store)
		_, err := store.persistRemote(
			context.Background(), "result.mp4", "task-1", "https://media.example.com/generated.mp4",
		)
		if err == nil {
			t.Fatal("expected oversized generated media to be rejected")
		}
		if implementation.reads != 0 {
			t.Fatalf("storage received %d reads, want 0", implementation.reads)
		}
	})
}

func TestProviderReferenceInlinesImageBytes(t *testing.T) {
	payload := []byte("small-image")
	storage, _ := newStorageClient(t, payload)
	store := New(storage, "http://localhost:8000")
	workspaceID := "workspace-1"
	reference, err := store.ProviderReference(context.Background(), "tenant-1", "user-1", domainasset.Asset{
		TenantID: "tenant-1", WorkspaceID: &workspaceID, SourceAssetID: "asset-1", SourceRevisionID: "revision-1",
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
	storage, _ := newStorageClient(t, []byte("short"))
	store := New(storage, "http://localhost:8000")
	workspaceID := "workspace-1"
	_, err := store.ProviderReference(context.Background(), "tenant-1", "user-1", domainasset.Asset{
		TenantID: "tenant-1", WorkspaceID: &workspaceID, SourceAssetID: "asset-1", SourceRevisionID: "revision-1",
		MediaType: domainasset.MediaImage, ContentType: "image/png", SizeBytes: 100,
	})
	if err == nil {
		t.Fatal("expected image size mismatch")
	}
}
