package coverimage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
)

const testBlobID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type fakeIDs struct {
	id  string
	err error
}

func (f fakeIDs) NewID() (string, error) { return f.id, f.err }

func TestStoreRegisterPNG(t *testing.T) {
	t.Parallel()

	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 504)...)
	server := objectServer(t, png)
	store := New(&storage.Client{URL: server.URL, Token: "token"}, fakeIDs{id: "cover-id"}, "")

	registration, err := store.Register(context.Background(), "tenant", "user", testBlobID)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if registration.Path != testBlobID || registration.ID != "cover-id" || registration.ContentType != "image/png" {
		t.Fatalf("Register() registration = %#v", registration)
	}
	if registration.SizeBytes != int64(len(png)) || registration.SHA256 == "" {
		t.Fatalf("Register() metadata = %#v", registration)
	}
}

func TestStoreRegisterRejectsUnsupportedContent(t *testing.T) {
	t.Parallel()

	server := objectServer(t, []byte("plain text"))
	store := New(&storage.Client{URL: server.URL}, fakeIDs{id: "cover-id"}, "")

	_, err := store.Register(context.Background(), "tenant", "user", testBlobID)
	if !errors.Is(err, applicationcoverimage.ErrUnsupportedFormat) {
		t.Fatalf("Register() error = %v, want ErrUnsupportedFormat", err)
	}
}

func TestStoreRegisterRejectsOversizedContent(t *testing.T) {
	t.Parallel()

	content := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, maximumCoverImageBytes)...)
	server := objectServer(t, content)
	store := New(&storage.Client{URL: server.URL}, fakeIDs{id: "cover-id"}, "")

	_, err := store.Register(context.Background(), "tenant", "user", testBlobID)
	if !errors.Is(err, applicationcoverimage.ErrTooLarge) {
		t.Fatalf("Register() error = %v, want ErrTooLarge", err)
	}
}

func TestStoreRegisterRejectsInvalidBlobIDWithoutStorageCall(t *testing.T) {
	t.Parallel()

	store := New(&storage.Client{URL: "http://127.0.0.1:1"}, fakeIDs{id: "cover-id"}, "")
	_, err := store.Register(context.Background(), "tenant", "user", "data:image/png;base64,AAAA")
	if !errors.Is(err, applicationcoverimage.ErrInvalidReference) {
		t.Fatalf("Register() error = %v, want ErrInvalidReference", err)
	}
}

func TestStorePresignReturnsPublicGatewayURL(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/artifacts/presign" {
			http.NotFound(response, request)
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]string{{
			"namespace":   knowledgeNamespace("canvas:cover:cover-id"),
			"artifact_id": "sha256",
			"url":         "/media/canvas/example",
			"expires_at":  time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		}}})
	}))
	t.Cleanup(server.Close)

	store := New(&storage.Client{URL: server.URL, Token: "token"}, fakeIDs{}, "http://gateway")
	urls, err := store.Presign(context.Background(), []applicationcoverimage.Registration{{
		ID: "cover-id", SHA256: "sha256", ContentType: "image/png",
	}})
	if err != nil {
		t.Fatalf("Presign() error = %v", err)
	}
	if urls["cover-id"] != "http://gateway/media/canvas/example" {
		t.Fatalf("Presign() URL = %q", urls["cover-id"])
	}
}

func objectServer(t *testing.T, staged []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			_, _ = response.Write(staged)
		case http.MethodPost:
			content, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("read stored body: %v", err)
			}
			digest := sha256.Sum256(content)
			value := hex.EncodeToString(digest[:])
			_ = json.NewEncoder(response).Encode(storage.StoredObject{
				ArtifactID: value, SHA256: value, Size: int64(len(content)),
			})
		default:
			response.WriteHeader(http.StatusNoContent)
		}
	}))
	t.Cleanup(server.Close)
	return server
}
