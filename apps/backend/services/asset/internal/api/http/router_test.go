package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/asset/internal/application"
	"github.com/example/monorepo/asset/internal/domain"
)

type deliveryRepository struct{ application.Repository }

func (deliveryRepository) GetRevision(_ context.Context, tenantID, workspaceID, assetID, revisionID string) (domain.Asset, domain.Revision, string, error) {
	if tenantID != "tenant/a" || workspaceID != "workspace b" || assetID != "asset" || revisionID != "revision" {
		return domain.Asset{}, domain.Revision{}, "", application.ErrNotFound
	}
	return domain.Asset{ID: assetID}, domain.Revision{ID: revisionID, AssetID: assetID, Filename: "sample.txt", MediaType: "text/plain", SHA256: strings.Repeat("a", 64), SizeBytes: 7, CreatedAt: time.Unix(1, 0)}, "blob-key", nil
}

type deliveryBlobStore struct{ application.BlobStore }

func (deliveryBlobStore) Open(context.Context, string) (application.BlobReader, error) {
	return application.BlobReader{Body: &readSeekCloser{Reader: strings.NewReader("payload")}, Size: 7}, nil
}

type readSeekCloser struct{ *strings.Reader }

func (*readSeekCloser) Close() error { return nil }

type deliveryClock struct{}

func (deliveryClock) Now() time.Time { return time.Now().UTC() }

type uploadRepository struct {
	application.Repository
	session application.UploadSession
}

func (repository *uploadRepository) ClaimUploadSession(_ context.Context, id string, _ time.Time) (application.UploadSession, error) {
	if id != repository.session.ID || repository.session.State != "pending" {
		return application.UploadSession{}, application.ErrConflict
	}
	repository.session.State = "uploading"
	return repository.session, nil
}

func (repository *uploadRepository) CompleteUpload(_ context.Context, input application.CompleteUploadInput) (application.CompleteUploadResult, error) {
	if repository.session.State != "uploading" || input.UploadID != repository.session.ID {
		return application.CompleteUploadResult{}, application.ErrConflict
	}
	repository.session.State = "completed"
	repository.session.AssetID = input.AssetID
	repository.session.RevisionID = input.RevisionID
	return application.CompleteUploadResult{
		Asset: domain.Asset{ID: input.AssetID},
		Revision: domain.Revision{
			ID: input.RevisionID, AssetID: input.AssetID, Filename: input.Filename, MediaType: input.MediaType,
			SizeBytes: input.SizeBytes, SHA256: input.SHA256,
		},
	}, nil
}

func (*uploadRepository) FailUpload(context.Context, string, string, time.Time) error { return nil }

type uploadBlobStore struct{ application.BlobStore }

func (uploadBlobStore) Stage(_ context.Context, uploadID string, source io.Reader, limit int64) (application.StagedBlob, error) {
	payload, err := io.ReadAll(io.LimitReader(source, limit+1))
	if err != nil {
		return application.StagedBlob{}, err
	}
	digest := sha256.Sum256(payload)
	return application.StagedBlob{UploadID: uploadID, TemporaryKey: "staging/part", SHA256: hex.EncodeToString(digest[:]), SizeBytes: int64(len(payload)), DetectedMediaType: "text/plain; charset=utf-8"}, nil
}
func (uploadBlobStore) Commit(context.Context, application.StagedBlob, string) error { return nil }
func (uploadBlobStore) Abort(context.Context, application.StagedBlob) error          { return nil }
func (uploadBlobStore) Delete(context.Context, string) error                         { return nil }

func TestDecodeJSONRejectsAmbiguousBodies(t *testing.T) {
	tests := map[string]string{
		"trailing value": `{"generation":1} {"generation":2}`,
		"too large":      `{"value":"` + strings.Repeat("a", (1<<20)+1) + `"}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/internal/claims:activate", strings.NewReader(body))
			var target map[string]any
			if err := decodeJSON(request, &target); err == nil {
				t.Fatal("expected invalid JSON body")
			}
		})
	}
}

func TestInternalRoutesRequireExactServiceIdentity(t *testing.T) {
	handler := NewRouter(nil, nil, map[string]string{"knowledge": "secret"}, 1024, RouterOptions{})
	for name, identity := range map[string][2]string{
		"missing":        {},
		"unknown caller": {"chat", "secret"},
		"wrong token":    {"knowledge", "other"},
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/internal/claims:activate", strings.NewReader(`{}`))
			request.Header.Set("X-Caller-Service", identity[0])
			request.Header.Set("X-Internal-Token", identity[1])
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
		})
	}
}

func TestDeliveryCapabilitySupportsGetAndHeadAndRejectsTampering(t *testing.T) {
	service := application.NewService(deliveryRepository{}, deliveryBlobStore{}, deliveryClock{}, 1024)
	handler := NewRouter(service, nil, map[string]string{"canvas": "secret"}, 1024, RouterOptions{DeliverySigningKey: "signing-secret", DeliveryURLTTL: time.Minute})
	body := strings.NewReader(`{"items":[{"tenant_id":"tenant/a","workspace_id":"workspace b","asset_id":"asset","revision_id":"revision"}]}`)
	request := httptest.NewRequest(http.MethodPost, "/internal/delivery-capabilities:mint", body)
	request.Header.Set("X-Caller-Service", "canvas")
	request.Header.Set("X-Internal-Token", "secret")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("mint status = %d: %s", response.Code, response.Body.String())
	}
	var minted struct {
		Items []struct {
			URL string `json:"url"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &minted); err != nil || len(minted.Items) != 1 {
		t.Fatalf("mint response = %s, error = %v", response.Body.String(), err)
	}
	capabilityURL, err := url.Parse(minted.Items[0].URL)
	if err != nil {
		t.Fatal(err)
	}
	capabilityURL.Path = strings.TrimPrefix(capabilityURL.Path, "/api/asset-server")
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		req := httptest.NewRequest(method, capabilityURL.String(), nil)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusOK || res.Header().Get("ETag") == "" {
			t.Fatalf("%s status = %d headers=%v body=%s", method, res.Code, res.Header(), res.Body.String())
		}
		if method == http.MethodGet && res.Body.String() != "payload" {
			t.Fatalf("GET body = %q", res.Body.String())
		}
		if method == http.MethodHead && res.Body.Len() != 0 {
			t.Fatalf("HEAD body = %q", res.Body.String())
		}
	}
	rangeRequest := httptest.NewRequest(http.MethodGet, capabilityURL.String(), nil)
	rangeRequest.Header.Set("Range", "bytes=1-3")
	rangeResponse := httptest.NewRecorder()
	handler.ServeHTTP(rangeResponse, rangeRequest)
	if rangeResponse.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want %d: %s", rangeResponse.Code, http.StatusPartialContent, rangeResponse.Body.String())
	}
	if rangeResponse.Body.String() != "ayl" {
		t.Fatalf("range body = %q, want %q", rangeResponse.Body.String(), "ayl")
	}
	if got := rangeResponse.Header().Get("Content-Range"); got != "bytes 1-3/7" {
		t.Fatalf("Content-Range = %q, want %q", got, "bytes 1-3/7")
	}
	if got := rangeResponse.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want %q", got, "bytes")
	}
	tampered := *capabilityURL
	query := tampered.Query()
	query.Set("workspace_id", "other")
	tampered.RawQuery = query.Encode()
	req := httptest.NewRequest(http.MethodGet, tampered.String(), nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("tampered status = %d", res.Code)
	}
}

func TestDeliveryCapabilityRejectsExpiredSignature(t *testing.T) {
	router := &Router{signingKey: []byte("signing-secret")}
	expires := time.Now().Add(-time.Second).Unix()
	signature := router.signDelivery("tenant", "workspace", "asset", "revision", expires)
	handler := NewRouter(nil, nil, nil, 1024, RouterOptions{DeliverySigningKey: "signing-secret"})
	request := httptest.NewRequest(http.MethodGet, "/media/asset/revisions/revision/content", nil)
	request.URL.RawQuery = url.Values{"tenant_id": {"tenant"}, "workspace_id": {"workspace"}, "expires": {fmt.Sprint(expires)}, "signature": {signature}}.Encode()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestUploadCapabilityRejectsExpiredOrTamperedSignature(t *testing.T) {
	t.Parallel()
	router := &Router{signingKey: []byte("signing-secret")}
	expiredAt := time.Now().Add(-time.Second).Unix()
	validUntil := time.Now().Add(time.Minute).Unix()
	for name, testCase := range map[string]struct {
		uploadID  string
		expires   int64
		signature string
	}{
		"expired": {
			uploadID: "upload", expires: expiredAt,
			signature: router.signUploadSession("upload", expiredAt),
		},
		"tampered id": {
			uploadID: "other", expires: validUntil,
			signature: router.signUploadSession("upload", validUntil),
		},
	} {
		t.Run(name, func(t *testing.T) {
			handler := NewRouter(nil, nil, nil, 1024, RouterOptions{DeliverySigningKey: "signing-secret"})
			target := fmt.Sprintf("/upload-sessions/%s/content?expires=%d&signature=%s", testCase.uploadID, testCase.expires, testCase.signature)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodPut, target, strings.NewReader("payload")))
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
			}
		})
	}
}

func TestUploadCapabilityStreamsAnAuthorizedExactFile(t *testing.T) {
	t.Parallel()
	expiresAt := time.Now().Add(time.Hour).UTC()
	repository := &uploadRepository{session: application.UploadSession{
		ID: "upload", TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", CallerService: "knowledge",
		IdempotencyKey: "intent", Category: "knowledge-source", Filename: "note.txt", MediaType: "text/plain",
		SizeBytes: 7, State: "pending", ExpiresAt: expiresAt,
	}}
	service := application.NewService(repository, uploadBlobStore{}, deliveryClock{}, 1024)
	handler := NewRouter(service, nil, nil, 1024, RouterOptions{DeliverySigningKey: "signing-secret"})
	signer := &Router{signingKey: []byte("signing-secret")}
	expires := expiresAt.Unix()
	target := fmt.Sprintf("/upload-sessions/upload/content?expires=%d&signature=%s", expires, signer.signUploadSession("upload", expires))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPut, target, strings.NewReader("payload")))
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if repository.session.State != "completed" || repository.session.AssetID == "" || repository.session.RevisionID == "" {
		t.Fatalf("session = %#v", repository.session)
	}
}
