package application

import (
	"context"
	"io"
	"time"

	"github.com/example/monorepo/asset/internal/domain"
)

type StagedBlob struct {
	UploadID, TemporaryKey, SHA256, DetectedMediaType string
	SizeBytes                                         int64
}

type BlobReader struct {
	Body io.ReadSeekCloser
	Size int64
}

type BlobStore interface {
	Stage(context.Context, string, io.Reader, int64) (StagedBlob, error)
	Commit(context.Context, StagedBlob, string) error
	Abort(context.Context, StagedBlob) error
	CleanupUpload(context.Context, string) error
	Open(context.Context, string) (BlobReader, error)
	Delete(context.Context, string) error
	Healthy(context.Context, int64) error
}

type Repository interface {
	BeginUpload(context.Context, CreateUploadInput, string, time.Time, time.Time) (BeginUploadResult, error)
	CreateUploadSession(context.Context, CreateUploadSessionInput, string, time.Time, time.Time) (UploadSession, error)
	ClaimUploadSession(context.Context, string, time.Time) (UploadSession, error)
	GetUploadSession(context.Context, string, string, string, string) (UploadSession, error)
	FailUpload(context.Context, string, string, time.Time) error
	CompleteUpload(context.Context, CompleteUploadInput) (CompleteUploadResult, error)
	GetRevision(context.Context, string, string, string, string) (domain.Asset, domain.Revision, string, error)
	PrepareClaim(context.Context, PrepareClaimInput, string, time.Time) (domain.Claim, error)
	ActivateClaim(context.Context, ClaimMutationInput, time.Time) (domain.Claim, error)
	ReleaseClaim(context.Context, ClaimMutationInput, time.Time) (domain.Claim, error)
	ExpireLeases(context.Context, time.Time, int) (int, error)
	ReconcileBlockingClaimCounts(context.Context, time.Time, int) (int, error)
	ClaimExpiredUploads(context.Context, time.Time, time.Time, int) ([]ExpiredUpload, error)
	CompleteUploadCleanup(context.Context, ExpiredUpload) error
	MarkCandidates(context.Context, time.Time, time.Time, time.Time, int) (int, error)
	ClaimDeletions(context.Context, time.Time, time.Time, int) ([]DeletionCandidate, error)
	CompleteDeletion(context.Context, DeletionCandidate, time.Time) error
	RetryDeletion(context.Context, DeletionCandidate, time.Time, string) error
	Ping(context.Context) error
}

type CreateUploadInput struct {
	TenantID, WorkspaceID, UserID, Filename, MediaType, Category string
	CallerService, IdempotencyKey                                string
}

type BeginUploadResult struct {
	UploadID, AssetID, RevisionID string
	Completed                     bool
}

type CreateUploadSessionInput struct {
	TenantID, WorkspaceID, UserID, Filename, MediaType, Category string
	CallerService, IdempotencyKey                                string
	SizeBytes                                                    int64
}

type UploadSession struct {
	ID, TenantID, WorkspaceID, UserID, Filename, MediaType, Category string
	CallerService, IdempotencyKey, State, AssetID, RevisionID        string
	SizeBytes                                                        int64
	ExpiresAt                                                        time.Time
}

type CompleteUploadInput struct {
	UploadID, AssetID, RevisionID, BlobID, StorageKey, SHA256    string
	UploadClaimID                                                string
	Filename, MediaType, Category, TenantID, WorkspaceID, UserID string
	SizeBytes                                                    int64
	Now                                                          time.Time
	UploadLeaseExpiresAt                                         time.Time
}

type CompleteUploadResult struct {
	Asset            domain.Asset
	Revision         domain.Revision
	UnusedStorageKey string
}

type PrepareClaimInput struct {
	TenantID, WorkspaceID, OwnerService, OwnerType, OwnerID, Slot string
	AssetID, RevisionID                                           string
	Kind                                                          domain.ClaimKind
	Generation                                                    int64
	ExpiresAt                                                     *time.Time
}

type ClaimMutationInput struct {
	TenantID, WorkspaceID, OwnerService, OwnerType, OwnerID, Slot string
	Generation                                                    int64
}

type DeletionCandidate struct {
	AssetID, TenantID string
	StateVersion      int64
	Blobs             []DeletionBlob
}

type ExpiredUpload struct {
	ID string
}

type DeletionBlob struct {
	ID, StorageKey string
}
