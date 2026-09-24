package coverimage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationcoverimage "github.com/example/monorepo/canvas/internal/application/coverimage"
	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
)

type claimStoreStub struct{ active, released applicationassetclaim.Intent }

func (stub *claimStoreStub) EnsureActive(_ context.Context, intent applicationassetclaim.Intent, _ time.Time) error {
	stub.active = intent
	return nil
}
func (stub *claimStoreStub) EnsureReleased(_ context.Context, intent applicationassetclaim.Intent, _ time.Time) error {
	stub.released = intent
	return nil
}
func (*claimStoreStub) ClaimDue(context.Context, time.Time, time.Time, int) ([]applicationassetclaim.Intent, error) {
	return nil, nil
}
func (*claimStoreStub) MarkDelivered(context.Context, applicationassetclaim.Intent, time.Time) (bool, error) {
	return false, nil
}
func (*claimStoreStub) Reschedule(context.Context, applicationassetclaim.Intent, time.Time, string, time.Time) (bool, error) {
	return false, nil
}

type clockStub struct{ now time.Time }

func (clock clockStub) Now() time.Time { return clock.now }

func TestStoreRegisterAndEnqueueStrongClaim(t *testing.T) {
	t.Parallel()
	var endpoints []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		endpoints = append(endpoints, request.URL.Path)
		switch request.URL.Path {
		case "/internal/assets/platform/revisions/revision":
			_ = json.NewEncoder(response).Encode(map[string]any{"asset_id": "platform", "revision_id": "revision", "media_type": "image/png", "size_bytes": 512, "sha256": "digest"})
		default:
			http.NotFound(response, request)
		}
	}))
	t.Cleanup(server.Close)
	claims := &claimStoreStub{}
	store := New(assetclient.New(server.URL, "token", nil), claims, clockStub{now: time.Now().UTC()}, "")
	registration, err := store.Register(context.Background(), applicationcoverimage.RegisterInput{TenantID: "tenant", UserID: "user", OwnerType: "canvas_cover", OwnerID: "canvas", Generation: 7, Revision: applicationcoverimage.RevisionRef{AssetID: "platform", RevisionID: "revision"}})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if registration.Revision.AssetID != "platform" || registration.Revision.RevisionID != "revision" || registration.Generation != 7 {
		t.Fatalf("Register() = %#v", registration)
	}
	if len(endpoints) != 1 {
		t.Fatalf("endpoints = %#v", endpoints)
	}
	if err = store.EnsureActive(context.Background(), registration); err != nil {
		t.Fatalf("EnsureActive() error = %v", err)
	}
	if claims.active.AssetID != "platform" || claims.active.RevisionID != "revision" || claims.active.Generation != 7 {
		t.Fatalf("claim = %#v", claims.active)
	}
}

func TestStorePresignReturnsGatewayURL(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]any{{"asset_id": "platform", "revision_id": "revision", "url": "/media/platform/revisions/revision/content", "expires_at": time.Now().Add(time.Hour).UTC()}}})
	}))
	t.Cleanup(server.Close)
	store := New(assetclient.New(server.URL, "token", nil), &claimStoreStub{}, clockStub{now: time.Now().UTC()}, "http://gateway")
	urls, err := store.Presign(context.Background(), []applicationcoverimage.Registration{{TenantID: "tenant", Revision: applicationcoverimage.RevisionRef{AssetID: "platform", RevisionID: "revision"}}})
	if err != nil {
		t.Fatalf("Presign() error = %v", err)
	}
	if urls["revision"] != "http://gateway/media/platform/revisions/revision/content" {
		t.Fatalf("URL = %q", urls["revision"])
	}
}
