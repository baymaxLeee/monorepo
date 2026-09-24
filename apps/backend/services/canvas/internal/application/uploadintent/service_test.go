package uploadintent

import (
	"context"
	"testing"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/assetclient"
)

type sessionCreatorStub struct {
	input assetclient.CreateUploadSessionInput
}

func (stub *sessionCreatorStub) CreateUploadSession(_ context.Context, input assetclient.CreateUploadSessionInput) (assetclient.UploadSession, error) {
	stub.input = input
	return assetclient.UploadSession{
		UploadSessionID: "session", IntentID: input.IdempotencyKey, State: "pending", UserID: input.UserID,
		Category: input.Category, Filename: input.Filename, MediaType: input.MediaType, SizeBytes: input.SizeBytes,
		ExpiresAt: time.Unix(100, 0), UploadURL: "/upload",
	}, nil
}

func TestPrepareBindsCanvasSourcePolicyAndIdentity(t *testing.T) {
	t.Parallel()
	stub := &sessionCreatorStub{}
	service := New(stub)
	input := PrepareInput{
		Scope:     Scope{TenantID: " tenant ", WorkspaceID: " workspace ", UserID: " user "},
		ClientRef: " client ", Purpose: PurposeSource, Filename: "clip.mp4", MediaType: "video/mp4", SizeBytes: 1024,
	}
	first, err := service.Prepare(context.Background(), input)
	if err != nil {
		t.Fatalf("Prepare() error = %v", err)
	}
	second, err := service.Prepare(context.Background(), input)
	if err != nil {
		t.Fatalf("Prepare() replay error = %v", err)
	}
	if first.IntentID == "" || first.IntentID != second.IntentID || stub.input.Category != "canvas-source" {
		t.Fatalf("plans = %#v %#v, input = %#v", first, second, stub.input)
	}
	if stub.input.TenantID != "tenant" || stub.input.WorkspaceID != "workspace" || stub.input.UserID != "user" || stub.input.SizeBytes != 1024 {
		t.Fatalf("input = %#v", stub.input)
	}
}

func TestPrepareRejectsUnsupportedOrOversizedFiles(t *testing.T) {
	t.Parallel()
	service := New(&sessionCreatorStub{})
	base := PrepareInput{Scope: Scope{TenantID: "tenant", UserID: "user"}, ClientRef: "client", Purpose: PurposeSource, Filename: "file", MediaType: "text/plain", SizeBytes: 1}
	if _, err := service.Prepare(context.Background(), base); err == nil {
		t.Fatal("expected unsupported media type error")
	}
	base.MediaType = "audio/mpeg"
	base.SizeBytes = 15*1024*1024 + 1
	if _, err := service.Prepare(context.Background(), base); err == nil {
		t.Fatal("expected size limit error")
	}
}
