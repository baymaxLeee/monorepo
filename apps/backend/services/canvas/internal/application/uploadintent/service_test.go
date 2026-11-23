package uploadintent

import (
	"context"
	"testing"
	"time"
)

type sessionCreatorStub struct {
	input   CreateUploadSessionInput
	session UploadSession
}

func (stub *sessionCreatorStub) CreateUploadSession(_ context.Context, input CreateUploadSessionInput) (UploadSession, error) {
	stub.input = input
	stub.session = UploadSession{
		UploadSessionID: "session", IntentID: input.IdempotencyKey, State: "pending",
		Filename: input.Filename, MediaType: input.MediaType, SizeBytes: input.SizeBytes,
		ExpiresAt: time.Unix(100, 0), UploadURL: "/upload",
	}
	return stub.session, nil
}

func (stub *sessionCreatorStub) GetUploadSession(_ context.Context, _ string) (UploadSession, error) {
	return stub.session, nil
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
	if first.IntentID == "" || first.IntentID != second.IntentID {
		t.Fatalf("plans = %#v %#v, input = %#v", first, second, stub.input)
	}
	if stub.input.SizeBytes != 1024 || stub.input.Filename != "clip.mp4" || stub.input.MediaType != "video/mp4" {
		t.Fatalf("input = %#v", stub.input)
	}
	input.UserID = "other-user"
	other, err := service.Prepare(context.Background(), input)
	if err != nil {
		t.Fatalf("Prepare() other identity error = %v", err)
	}
	if other.IntentID == first.IntentID {
		t.Fatal("upload intent must be bound to the Canvas business identity")
	}
}

func TestResolveRequiresMatchingCompletedBusinessIntent(t *testing.T) {
	t.Parallel()
	scope := Scope{TenantID: "tenant", WorkspaceID: "workspace", UserID: "user"}
	stub := &sessionCreatorStub{session: UploadSession{
		UploadSessionID: "session", IntentID: uploadIntentID(scope, PurposeSource, "client"), State: "completed",
		Filename: "clip.mp4", MediaType: "video/mp4", SizeBytes: 1024, AssetID: "asset", RevisionID: "revision",
	}}
	service := New(stub)
	resolved, err := service.Resolve(context.Background(), ResolveInput{Scope: scope, ClientRef: "client", Purpose: PurposeSource, UploadSessionID: "session"})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if resolved.AssetID != "asset" || resolved.RevisionID != "revision" {
		t.Fatalf("Resolve() = %#v", resolved)
	}
	foreign := scope
	foreign.UserID = "other-user"
	if _, err = service.Resolve(context.Background(), ResolveInput{Scope: foreign, ClientRef: "client", Purpose: PurposeSource, UploadSessionID: "session"}); err == nil {
		t.Fatal("Resolve() accepted another business identity")
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
