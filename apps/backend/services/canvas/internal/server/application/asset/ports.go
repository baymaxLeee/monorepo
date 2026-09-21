package asset

import (
	"context"
	"errors"
	"time"

	applicationquota "github.com/example/monorepo/canvas/internal/server/application/quota"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
)

var (
	ErrNotFound          = errors.New("asset not found")
	ErrOwnerNotFound     = errors.New("asset owner not found")
	ErrUnsupportedFormat = errors.New("unsupported asset format")
)

type Scope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type DetectedBlob struct {
	MediaType   domainasset.MediaType
	ContentType string
}

type RegisteredArtifact struct {
	ArtifactID        string
	ArtifactNamespace string
	SizeBytes         int64
}

type RegisterArtifactInput struct {
	BlobID   string
	FileName string
}

type RegisterArtifactResult struct {
	Artifact RegisteredArtifact
	Err      error
}

type PresignedArtifact struct {
	URL       string
	ExpiresAt time.Time
}

type Repository interface {
	Create(context.Context, domainasset.Asset) error
	Get(context.Context, Scope, string) (domainasset.Asset, error)
	GetCommitted(context.Context, Scope, string) (domainasset.Asset, error)
	GetForUpdate(context.Context, Scope, string) (domainasset.Asset, error)
	GetReferenced(context.Context, Scope, ReferenceOwner, string, bool) (domainasset.Asset, error)
	GetByCreationKey(context.Context, Scope, domainasset.OwnerType, string, string) (domainasset.Asset, error)
	BatchGet(context.Context, Scope, []string) ([]domainasset.Asset, error)
	BatchGetReferenced(context.Context, Scope, ReferenceOwner, []string) ([]domainasset.Asset, error)
	BatchGetReferencedAssets(context.Context, Scope, []AssetReference) ([]ReferencedAsset, error)
	ListByOwner(context.Context, Scope, domainasset.OwnerType, string, int) ([]domainasset.Asset, error)
	DeleteByOwner(context.Context, Scope, domainasset.OwnerType, string, time.Time, time.Time) ([]GarbageCollectionAsset, error)
	DeleteByTenant(context.Context, string, time.Time, time.Time) ([]GarbageCollectionAsset, error)
	DeleteByWorkspace(context.Context, string, string, time.Time, time.Time) ([]GarbageCollectionAsset, error)
}

type ReviewCleanupPreparer interface {
	PrepareAssetReviewCleanup(context.Context, GarbageCollectionAsset) error
}

type ReviewCleanupFailureReporter interface {
	ReportReviewCleanupFailure(context.Context, GarbageCollectionAsset, error)
}

type ReviewReader interface {
	BatchGetAssetReviews(context.Context, Scope, []string) (map[string][]domainasset.Review, error)
}

type OwnerResolver interface {
	Validate(context.Context, Scope, domainasset.OwnerType, string) error
	ValidateForUpdate(context.Context, Scope, domainasset.OwnerType, string) error
}

type ArtifactStore interface {
	Inspect(context.Context, string, string, string) (DetectedBlob, error)
	Register(context.Context, string, string, string, string, string) (RegisteredArtifact, error)
	Delete(context.Context, string, string) error
	BatchPresignArtifacts(context.Context, string, string, string, []string) (map[string]PresignedArtifact, error)
}

type ArtifactBatchRegistrar interface {
	RegisterMany(context.Context, string, string, string, []RegisterArtifactInput) []RegisterArtifactResult
}

type IDGenerator interface {
	NewID() (string, error)
}

type Clock interface {
	Now() time.Time
}

type StorageQuota interface {
	ReserveStorage(context.Context, string, string, string, string, string, int64) (applicationquota.Reservation, error)
	CommitStorage(context.Context, applicationquota.Reservation, applicationquota.StorageObject) error
	RecordStorage(context.Context, applicationquota.StorageObject) error
	RecordAdmittedStorage(context.Context, applicationquota.StorageObject) error
	ReleaseReservation(context.Context, applicationquota.Reservation) error
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}
