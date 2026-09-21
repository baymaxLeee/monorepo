package resource

import (
	"context"
	"errors"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/server/domain/resourceassetgeneration"
)

var (
	ErrNotFound                   = errors.New("resource not found")
	ErrProjectNotFound            = errors.New("resource project not found")
	ErrNameConflict               = errors.New("resource name conflict")
	ErrLimitExceeded              = errors.New("resource limit exceeded")
	ErrRevisionConflict           = errors.New("resource revision conflict")
	ErrResourceAssetLimitExceeded = errors.New("resource asset limit exceeded")
	ErrResourceAssetNameConflict  = errors.New("resource asset name conflict")
	ErrResourceAssetNotFound      = errors.New("resource asset not found")
	ErrAssetOwnerMismatch         = errors.New("resource asset owner mismatch")
	ErrAssetMediaTypeMismatch     = errors.New("resource asset media type mismatch")
	ErrCanvasNodeAssetNotBindable = errors.New("canvas node asset is not bindable")
)

type Scope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

// OfficialMaterializer 在某个 scope 首次读资源库时按官方清单幂等物化官方记录。
//
// OFFICIAL Resource 与 PROJECT Resource 共用 resources 表和同一套 scope 条件，官方记录
// 必须在调用方 scope 下真实存在才可见，而 AgentFrame 没有租户枚举来源，无法在启动时预先为
// 所有租户铺好行（ADR-002）。
//
// 物化是 best-effort：它按清单写入、不接受调用方输入，失败不应让用户的资源库读取失败。
type OfficialMaterializer interface {
	MaterializeForScope(context.Context, Scope)
}

// OfficialMaterializationFailureReporter 让 best-effort 物化失败可观测，而不改变读取
// 用例的成功结果。
type OfficialMaterializationFailureReporter interface {
	Report(context.Context, error)
}

type SortField int

const (
	SortUnspecified SortField = iota
	SortCreatedAt
	SortUpdatedAt
)

type SortDirection int

const (
	SortDirectionUnspecified SortDirection = iota
	SortAscending
	SortDescending
)

type Page struct {
	PageSize int
	PageNum  int
}

type ListQuery struct {
	Scope
	ProjectID     string
	Type          *domainresource.Type
	Keyword       string
	SortField     SortField
	SortDirection SortDirection
	PageSize      int
	PageNum       int
}

type Repository interface {
	ValidateCreate(context.Context, domainresource.Resource) error
	Create(context.Context, domainresource.Resource) error
	Get(context.Context, Scope, string, string) (domainresource.Resource, error)
	BatchGet(context.Context, Scope, string, []string) ([]domainresource.Resource, error)
	List(context.Context, ListQuery) ([]domainresource.Resource, int64, error)
	Update(context.Context, domainresource.Resource) error
	GetForUpdate(context.Context, Scope, string, string) (domainresource.Resource, error)
	NextResourceAssetSequence(context.Context, string) (int64, error)
	ResourceAssetNameExists(context.Context, string, string) (bool, error)
	CreateResourceAsset(context.Context, domainresource.ResourceAsset, string) error
	GetResourceAsset(context.Context, string, string) (domainresource.ResourceAsset, error)
	BatchGetResourceAssets(context.Context, Scope, string, []string) ([]domainresource.ResourceAsset, error)
	ListResourceAssetsByResourceIDs(context.Context, Scope, string, []string) ([]domainresource.ResourceAsset, error)
	GetResourceAssetForUpdate(context.Context, string, string) (domainresource.ResourceAsset, error)
	ResourceAssetRevisionExists(context.Context, string, string) (bool, error)
	ListResourceAssets(context.Context, string, *string, int, int) ([]domainresource.ResourceAsset, int64, error)
	StatsByProject(context.Context, Scope, string) (ResourceStats, error)
	UpdateResourceAsset(context.Context, domainresource.ResourceAsset, int64, *string) error
	DeleteResourceAsset(context.Context, domainresource.ResourceAsset, int64, time.Time) ([]string, error)
	DeleteWithRevisionAssets(context.Context, domainresource.Resource, time.Time) ([]string, error)
	ListByProjectForUpdate(context.Context, Scope, string) ([]domainresource.Resource, error)
}

type ProjectResolver interface {
	Validate(context.Context, Scope, string) error
}

type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }

type AssetReader interface {
	BypassGetForUpdate(context.Context, applicationasset.BypassGetInput) (domainasset.Asset, error)
}

type AssetCreator interface {
	Create(context.Context, applicationasset.CreateInput) (domainasset.Asset, error)
	CompensateCreated(context.Context, domainasset.Asset) error
	PrepareResourceOwnedCreates(context.Context, applicationasset.Scope, *string, string, []applicationasset.PrepareCreateItem) ([]applicationasset.PreparedCreate, error)
	RegisterPreparedCreates(context.Context, []applicationasset.PreparedCreate) ([]domainasset.Asset, error)
	PersistPreparedCreates(context.Context, []domainasset.Asset) error
	CompensateCreatedMany(context.Context, []domainasset.Asset, error) error
}

type AssetImporter interface {
	CreateFromArtifact(context.Context, applicationasset.CreateFromArtifactInput) (domainasset.Asset, error)
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type CanvasNodeAssetBindingInput struct {
	Scope
	ProjectID, CanvasID, CanvasNodeID, AssetID, ResourceAssetID string
	UpdatedAt                                                   time.Time
}

type CanvasNodeAssetBinding struct {
	CanvasID, CanvasNodeID, ResourceAssetID, CurrentAssetID string
	CanvasNodeRevision                                      int64
}

type CanvasNodeAssetBinder interface {
	BindCanvasNodeAsset(context.Context, CanvasNodeAssetBindingInput) (CanvasNodeAssetBinding, error)
}

type ImageGenerationDraftStore interface {
	Create(context.Context, domainresourceassetgeneration.Draft) error
	Delete(context.Context, string, *string, string, time.Time) ([]string, error)
	DeleteByResource(context.Context, string, *string, string, time.Time) ([]string, error)
}

type AssetOwnerDeleter interface {
	DeleteByOwner(context.Context, applicationasset.DeleteByOwnerInput) error
	PrepareReviewCleanup(context.Context, applicationasset.Scope, []string) error
}
type CleanupFailureReporter interface{ Report(context.Context, error) }
