package application

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/asset/internal/domain"
)

type fixedClock struct{ now time.Time }

func (clock fixedClock) Now() time.Time { return clock.now }

type repositoryStub struct {
	Repository
	created        CreateUploadInput
	beginResult    BeginUploadResult
	completed      CompleteUploadInput
	completeResult CompleteUploadResult
	completeErr    error
	prepared       PrepareClaimInput
	mutated        ClaimMutationInput
}

type revisionRepositoryStub struct{ Repository }

func (revisionRepositoryStub) GetRevision(context.Context, string, string, string, string) (domain.Asset, domain.Revision, string, error) {
	return domain.Asset{ID: "asset"}, domain.Revision{ID: "revision"}, "storage-key", nil
}

func (stub *repositoryStub) BeginUpload(_ context.Context, input CreateUploadInput, id string, _, _ time.Time) (BeginUploadResult, error) {
	stub.created = input
	if stub.beginResult.UploadID == "" {
		stub.beginResult.UploadID = id
	}
	return stub.beginResult, nil
}
func (stub *repositoryStub) FailUpload(context.Context, string, string, time.Time) error { return nil }
func (stub *repositoryStub) CompleteUpload(_ context.Context, input CompleteUploadInput) (CompleteUploadResult, error) {
	stub.completed = input
	return stub.completeResult, stub.completeErr
}
func (stub *repositoryStub) PrepareClaim(_ context.Context, input PrepareClaimInput, _ string, _ time.Time) (domain.Claim, error) {
	stub.prepared = input
	return domain.Claim{AssetID: input.AssetID, Kind: input.Kind}, nil
}
func (stub *repositoryStub) ActivateClaim(_ context.Context, input ClaimMutationInput, _ time.Time) (domain.Claim, error) {
	stub.mutated = input
	return domain.Claim{Status: "active"}, nil
}
func (stub *repositoryStub) ReleaseClaim(_ context.Context, input ClaimMutationInput, _ time.Time) (domain.Claim, error) {
	stub.mutated = input
	return domain.Claim{Status: "released"}, nil
}

type blobStoreStub struct {
	BlobStore
	staged      StagedBlob
	stagedCalls int
	deleted     []string
}

func (stub *blobStoreStub) Stage(context.Context, string, io.Reader, int64) (StagedBlob, error) {
	stub.stagedCalls++
	return stub.staged, nil
}
func (stub *blobStoreStub) Commit(context.Context, StagedBlob, string) error { return nil }
func (stub *blobStoreStub) Abort(context.Context, StagedBlob) error          { return nil }
func (stub *blobStoreStub) Delete(_ context.Context, key string) error {
	stub.deleted = append(stub.deleted, key)
	return nil
}

func TestServiceUpload(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)

	t.Run("rejects a blank filename", func(t *testing.T) {
		service := NewService(&repositoryStub{}, &blobStoreStub{}, fixedClock{now}, 1024)
		_, _, err := service.Upload(context.Background(), CreateUploadInput{TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", Filename: "   ", Category: "document", CallerService: "test"}, strings.NewReader("data"))
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("requires an idempotency key for service uploads", func(t *testing.T) {
		service := NewService(&repositoryStub{}, &blobStoreStub{}, fixedClock{now}, 1024)
		_, _, err := service.Upload(context.Background(), CreateUploadInput{TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", Filename: "note.md", Category: "document", CallerService: "test"}, strings.NewReader("data"))
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("error = %v, want ErrInvalidInput", err)
		}
	})

	t.Run("commits metadata and removes a deduplicated private copy", func(t *testing.T) {
		repository := &repositoryStub{completeResult: CompleteUploadResult{
			Asset: domain.Asset{ID: "asset"}, Revision: domain.Revision{ID: "revision"}, UnusedStorageKey: "blobs/private-copy",
		}}
		storage := &blobStoreStub{staged: StagedBlob{TemporaryKey: "staging/upload.part", SHA256: strings.Repeat("a", 64), SizeBytes: 4, DetectedMediaType: "text/plain; charset=utf-8"}}
		service := NewService(repository, storage, fixedClock{now}, 1024)
		asset, revision, err := service.Upload(context.Background(), CreateUploadInput{TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", Filename: "folder/note.md", Category: "document", CallerService: "test", IdempotencyKey: "upload-1"}, strings.NewReader("data"))
		if err != nil {
			t.Fatal(err)
		}
		if asset.ID != "asset" || revision.ID != "revision" {
			t.Fatalf("unexpected result: %#v %#v", asset, revision)
		}
		if repository.created.Filename != "note.md" || repository.completed.Filename != "note.md" {
			t.Fatalf("filename was not normalized: %#v %#v", repository.created, repository.completed)
		}
		if strings.Contains(repository.completed.StorageKey, "tenant") {
			t.Fatalf("storage key leaks tenant ID: %s", repository.completed.StorageKey)
		}
		if len(storage.deleted) != 1 || storage.deleted[0] != "blobs/private-copy" {
			t.Fatalf("deleted = %v", storage.deleted)
		}
		if repository.completed.UploadClaimID == "" {
			t.Fatal("upload protection claim ID was not created")
		}
		if want := now.Add(24 * time.Hour); !repository.completed.UploadLeaseExpiresAt.Equal(want) {
			t.Fatalf("upload lease expires at %s, want %s", repository.completed.UploadLeaseExpiresAt, want)
		}
	})

	t.Run("returns a completed idempotent upload without reading the retry body", func(t *testing.T) {
		repository := &repositoryStub{beginResult: BeginUploadResult{UploadID: "upload", AssetID: "asset", RevisionID: "revision", Completed: true}}
		repository.Repository = revisionRepositoryStub{}
		storage := &blobStoreStub{}
		service := NewService(repository, storage, fixedClock{now}, 1024)
		asset, revision, err := service.Upload(context.Background(), CreateUploadInput{
			TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", Filename: "video.mp4",
			Category: "generated-video", CallerService: "executor", IdempotencyKey: "step-1",
		}, strings.NewReader("retry body"))
		if err != nil {
			t.Fatal(err)
		}
		if asset.ID != "asset" || revision.ID != "revision" || storage.stagedCalls != 0 {
			t.Fatalf("result = %#v %#v, staged calls = %d", asset, revision, storage.stagedCalls)
		}
	})

	t.Run("retains promoted bytes after ambiguous database failure", func(t *testing.T) {
		repository := &repositoryStub{completeErr: errors.New("commit outcome unknown")}
		storage := &blobStoreStub{staged: StagedBlob{TemporaryKey: "staging/upload.part", SHA256: strings.Repeat("b", 64), SizeBytes: 4, DetectedMediaType: "application/octet-stream"}}
		service := NewService(repository, storage, fixedClock{now}, 1024)
		_, _, err := service.Upload(context.Background(), CreateUploadInput{TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", Filename: "note.md", MediaType: "text/markdown", Category: "document", CallerService: "test", IdempotencyKey: "upload-1"}, strings.NewReader("data"))
		if err == nil {
			t.Fatal("expected database error")
		}
		if len(storage.deleted) != 0 {
			t.Fatalf("ambiguous blob was deleted: %v", storage.deleted)
		}
	})
}

func TestServicePrepareClaim(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	valid := PrepareClaimInput{TenantID: "tenant", WorkspaceID: "workspace", OwnerService: "chat", OwnerType: "message", OwnerID: "message-1", Slot: "attachment-1", AssetID: "asset", Kind: domain.ClaimStrong, Generation: 1}

	t.Run("accepts a complete strong claim", func(t *testing.T) {
		repository := &repositoryStub{}
		service := NewService(repository, &blobStoreStub{}, fixedClock{now}, 1024)
		if _, err := service.PrepareClaim(context.Background(), valid); err != nil {
			t.Fatal(err)
		}
		if repository.prepared.OwnerID != valid.OwnerID {
			t.Fatalf("prepared = %#v", repository.prepared)
		}
	})

	t.Run("lease requires a future expiry", func(t *testing.T) {
		expired := now.Add(-time.Second)
		for name, expiresAt := range map[string]*time.Time{"missing": nil, "expired": &expired} {
			t.Run(name, func(t *testing.T) {
				input := valid
				input.Kind = domain.ClaimLease
				input.ExpiresAt = expiresAt
				service := NewService(&repositoryStub{}, &blobStoreStub{}, fixedClock{now}, 1024)
				if _, err := service.PrepareClaim(context.Background(), input); !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("error = %v, want ErrInvalidInput", err)
				}
			})
		}
	})
}

func TestServiceClaimMutations(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	service := NewService(&repositoryStub{}, &blobStoreStub{}, fixedClock{now}, 1024)
	invalid := ClaimMutationInput{Generation: 0}
	if _, err := service.ActivateClaim(context.Background(), invalid); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("activate error = %v, want ErrInvalidInput", err)
	}
	if _, err := service.ReleaseClaim(context.Background(), invalid); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("release error = %v, want ErrInvalidInput", err)
	}
}
