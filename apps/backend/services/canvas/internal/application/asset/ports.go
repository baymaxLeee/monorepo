package asset

import (
	"context"
	"errors"
	"time"

	assetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
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

type ResolvedRevision struct {
	SourceAssetID    string
	SourceRevisionID string
	MediaType        domainasset.MediaType
	ContentType      string
	SizeBytes        int64
}

type RevisionRef struct {
	SourceAssetID    string
	SourceRevisionID string
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
	DeleteByOwner(context.Context, Scope, domainasset.OwnerType, string, time.Time) ([]RetiredAsset, error)
	DeleteByTenant(context.Context, string, time.Time) ([]RetiredAsset, error)
	DeleteByWorkspace(context.Context, string, string, time.Time) ([]RetiredAsset, error)
}

// RetiredAsset carries the business attachment identity needed to retire its
// platform Claim. Physical retention and byte deletion are owned by Asset.
type RetiredAsset struct {
	AssetID          string
	TenantID         string
	WorkspaceID      *string
	SourceAssetID    string
	SourceRevisionID string
}

type ReviewCleanupPreparer interface {
	PrepareAssetReviewCleanup(context.Context, RetiredAsset) error
}

type ReviewCleanupFailureReporter interface {
	ReportReviewCleanupFailure(context.Context, RetiredAsset, error)
}

type ReviewReader interface {
	BatchGetAssetReviews(context.Context, Scope, []string) (map[string][]domainasset.Review, error)
}

type OwnerResolver interface {
	Validate(context.Context, Scope, domainasset.OwnerType, string) error
	ValidateForUpdate(context.Context, Scope, domainasset.OwnerType, string) error
}

type RevisionStore interface {
	Resolve(context.Context, string, string, RevisionRef) (ResolvedRevision, error)
	BatchDeliveryURLs(context.Context, string, string, []RevisionRef) (map[string]PresignedArtifact, error)
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
	ReleaseStorage(context.Context, string, string) (bool, error)
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type ClaimIntentStore interface {
	EnsureActive(context.Context, assetclaim.Intent, time.Time) error
	EnsureReleased(context.Context, assetclaim.Intent, time.Time) error
}
