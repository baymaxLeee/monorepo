package resourceassetgeneration

import (
	"context"
	"errors"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/domain/resourceassetgeneration"
)

var (
	ErrDraftNotFound         = errors.New("resource asset image generation draft not found")
	ErrDraftRevisionConflict = errors.New("resource asset image generation draft revision conflict")
	ErrDraftReferenceInvalid = errors.New("resource asset image generation draft reference is invalid")
	ErrDraftRunActive        = errors.New("resource asset image generation draft run is active")
	ErrDraftRunConflict      = errors.New("resource asset image generation draft run conflict")
	ErrDraftConfigIncomplete = errors.New("resource asset image generation draft config is incomplete")
)

type DraftScope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type ReferenceDelta struct {
	AddedAssetIDs   []string
	RemovedAssetIDs []string
}

type DraftRepository interface {
	Create(context.Context, domainresourceassetgeneration.Draft) error
	Get(context.Context, DraftScope, string) (domainresourceassetgeneration.Draft, error)
	GetForUpdate(context.Context, DraftScope, string) (domainresourceassetgeneration.Draft, error)
	Update(context.Context, domainresourceassetgeneration.Draft, int64) (ReferenceDelta, error)
	SetActiveTaskRun(context.Context, DraftScope, string, string) (bool, error)
	ClearActiveTaskRun(context.Context, DraftScope, string, string) (bool, error)
}

type DraftAssetReader interface {
	BypassGetForUpdate(context.Context, applicationasset.BypassGetInput) (domainasset.Asset, error)
}

type DraftAssetMaterializer interface {
	PrepareResourceOwnedCreates(context.Context, applicationasset.Scope, *string, string, []applicationasset.PrepareCreateItem) ([]applicationasset.PreparedCreate, error)
	RegisterPreparedCreates(context.Context, []applicationasset.PreparedCreate) ([]domainasset.Asset, error)
	PersistPreparedCreates(context.Context, []domainasset.Asset) error
	CompensateCreatedMany(context.Context, []domainasset.Asset, error) error
}

type DraftResourceAssetStore interface {
	GetResourceAssetForUpdate(context.Context, string, string) (domainresource.ResourceAsset, error)
	GetResourceAssetBySequenceForUpdate(context.Context, string, int64) (domainresource.ResourceAsset, error)
	UpdateResourceAsset(context.Context, domainresource.ResourceAsset, int64, *string) error
}

type DraftReviewCleanup interface {
	PrepareReviewCleanup(context.Context, applicationasset.Scope, []string) error
}

type DraftTransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type DraftAssetReferenceTracker interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAssets(context.Context, applicationasset.ReleaseAssetsInput) error
}

type DraftClock interface{ Now() time.Time }
