package project

import (
	"context"
	"testing"

	applicationuploadintent "github.com/example/monorepo/canvas/internal/application/uploadintent"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type coverUploadResolverStub struct {
	input    applicationuploadintent.ResolveInput
	resolved applicationuploadintent.ResolvedUpload
	calls    int
}

func (s *coverUploadResolverStub) Resolve(
	_ context.Context,
	input applicationuploadintent.ResolveInput,
) (applicationuploadintent.ResolvedUpload, error) {
	s.calls++
	s.input = input
	return s.resolved, nil
}

func TestResolveCoverUploadDerivesRevisionFromScopeBoundReceipt(t *testing.T) {
	workspaceID := "workspace"
	resolver := &coverUploadResolverStub{resolved: applicationuploadintent.ResolvedUpload{
		AssetID: "asset", RevisionID: "revision",
	}}
	service := &Service{uploadIntents: resolver}
	assetID, revisionID, err := service.resolveCoverUpload(context.Background(), Scope{
		TenantID: "tenant", WorkspaceID: &workspaceID, CallerID: "user",
	}, &CoverUpload{UploadSessionID: "session", ClientRef: "client"}, false)
	if err != nil {
		t.Fatalf("resolveCoverUpload() error = %v", err)
	}
	if assetID == nil || *assetID != "asset" || revisionID == nil || *revisionID != "revision" {
		t.Fatalf("resolved reference = (%v, %v)", assetID, revisionID)
	}
	if resolver.calls != 1 || resolver.input.TenantID != "tenant" || resolver.input.WorkspaceID != workspaceID ||
		resolver.input.UserID != "user" || resolver.input.Purpose != applicationuploadintent.PurposeCover ||
		resolver.input.UploadSessionID != "session" || resolver.input.ClientRef != "client" {
		t.Fatalf("Resolve() input = %#v, calls = %d", resolver.input, resolver.calls)
	}
}

func TestResolveCoverUploadKeepsClearExplicit(t *testing.T) {
	resolver := &coverUploadResolverStub{}
	service := &Service{uploadIntents: resolver}
	assetID, revisionID, err := service.resolveCoverUpload(context.Background(), Scope{}, nil, true)
	if err != nil {
		t.Fatalf("resolveCoverUpload(clear) error = %v", err)
	}
	if assetID == nil || *assetID != "" || revisionID == nil || *revisionID != "" || resolver.calls != 0 {
		t.Fatalf("clear result = (%v, %v), resolver calls = %d", assetID, revisionID, resolver.calls)
	}
	_, _, err = service.resolveCoverUpload(
		context.Background(), Scope{}, &CoverUpload{UploadSessionID: "session", ClientRef: "client"}, true,
	)
	if !errno.IsCode(err, errno.ErrInvalidArgument) || resolver.calls != 0 {
		t.Fatalf("upload plus clear error = %v, resolver calls = %d", err, resolver.calls)
	}
}
