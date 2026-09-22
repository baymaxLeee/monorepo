package canvas

import (
	"context"
	"errors"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/domain/assetmatching"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
)

var (
	ErrNotFound                = errors.New("canvas or project not found")
	ErrNameConflict            = errors.New("canvas name conflict")
	ErrLimitExceeded           = errors.New("canvas limit exceeded")
	ErrCanvasNodeLimitExceeded = errors.New("canvas canvasnode limit exceeded")
	ErrAssetMissing            = errors.New("canvas canvasnode asset missing")
	ErrRevisionConflict        = errors.New("canvas revision conflict")
)

type Scope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type SortDirection int

const (
	SortUnspecified SortDirection = iota
	SortAscending
	SortDescending
)

type Page struct {
	PageSize int
	PageNum  int
}

type ListQuery struct {
	TenantID      string
	WorkspaceID   *string
	ProjectID     string
	CreatedBy     string
	Keyword       string
	SortDirection SortDirection
	PageSize      int
	PageNum       int
}

type Repository interface {
	CanvasViewRepository
	Create(context.Context, domaincanvas.Canvas) error
	Get(context.Context, Scope, string, string) (domaincanvas.Canvas, error)
	BatchGet(context.Context, Scope, string, []string) ([]domaincanvas.Canvas, error)
	List(context.Context, ListQuery) ([]domaincanvas.Canvas, int64, error)
	Update(context.Context, domaincanvas.Canvas) error
	Delete(context.Context, domaincanvas.Canvas) error
	DeleteByProject(context.Context, Scope, string, time.Time) ([]DeletionTarget, error)
	DeletionMatches(context.Context, Scope, string, string, int64, time.Time) (bool, error)
}

type CanvasViewRepository interface {
	UpdateView(context.Context, Scope, string, string, *domaincanvas.ViewMode) error
}

type CanvasNodeRepository interface {
	CanvasGraphRepository
	List(context.Context, Scope, string, string) ([]domaincanvas.CanvasNode, error)
	ListForUpdate(context.Context, Scope, string, string) ([]domaincanvas.CanvasNode, error)
	ListIDs(context.Context, Scope, string, string) ([]string, error)
	Get(context.Context, Scope, string, string, string) (domaincanvas.CanvasNode, error)
	GetForUpdate(context.Context, Scope, string, string, string) (domaincanvas.CanvasNode, error)
	BatchGet(context.Context, Scope, string, string, []string) ([]domaincanvas.CanvasNode, error)
	GetByID(context.Context, Scope, string) (domaincanvas.CanvasNode, error)
	Number(context.Context, Scope, string, string, string) (int32, error)
	Create(context.Context, domaincanvas.CanvasNode, *string) (int32, error)
	Update(context.Context, domaincanvas.CanvasNode, domaincanvas.UpdatePatch) (int32, int64, string, error)
	Delete(context.Context, domaincanvas.CanvasNode) (string, []string, error)
	DeleteByCanvas(context.Context, Scope, string, string, time.Time) ([]domaincanvas.CanvasNode, []string, error)
	DeletionMatches(context.Context, Scope, string, string, string, int64, time.Time) (bool, error)
}

type CanvasGraphRepository interface {
	LockCanvas(context.Context, Scope, string, string) (int64, error)
	AdvanceCanvasRevision(context.Context, Scope, string, string, int64, time.Time) (int64, error)
	UpdateStoryboardRanks(context.Context, Scope, string, string, map[string]int64, time.Time) error
}

type CanvasAssetResolver interface {
	BypassGet(context.Context, applicationasset.BypassGetInput) (domainasset.Asset, error)
}

type CanvasResourceAssetReference struct {
	ResourceID      string
	ResourceAssetID string
	Revision        int64
	Name            string
	IsPrimary       bool
	Asset           domainasset.Asset
}

type CanvasResourceResolver interface {
	CanvasResourceAssetResolver
	ResolvePrimaryResourceAsset(context.Context, Scope, string, string) (CanvasResourceAssetReference, error)
}

type CanvasResourceBatchResolver interface {
	BatchResolvePrimaryResourceAssets(context.Context, Scope, string, []string) (map[string]CanvasResourceAssetReference, error)
}

type CanvasResourceAssetResolver interface {
	ResolveCurrentResourceAsset(context.Context, Scope, string, string) (CanvasResourceAssetReference, error)
}

type CanvasResourceAssetBatchResolver interface {
	BatchResolveCurrentResourceAssets(context.Context, Scope, string, []string) (map[string]CanvasResourceAssetReference, error)
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type StorageQuota interface {
	ReserveStorage(context.Context, string, string, string, string, string, int64) (applicationquota.Reservation, error)
	CommitStorage(context.Context, applicationquota.Reservation, applicationquota.StorageObject) error
	MarkStorageReleasing(context.Context, string, string) (bool, error)
	ReleaseStorage(context.Context, string, string) (bool, error)
	ReleaseReservation(context.Context, applicationquota.Reservation) error
}

type CanvasStatisticsRebuilder interface {
	Rebuild(context.Context, Scope, string, string) error
}

type CanvasStatisticsFailureReporter interface {
	ReportCanvasStatisticsFailure(context.Context, error)
}

type CanvasStatisticsProjector interface {
	Refresh(context.Context, Scope, string, string)
}

type CreateNodeInput struct {
	ProjectID       string
	CanvasID        string
	AfterNodeID     string
	Type            domaincanvas.NodeType
	Position        domaincanvas.Position
	Text            string
	AssetID         string
	ResourceID      string
	ResourceAssetID string
	ModelServiceID  string
	UploadedAsset   *UploadedAssetInput
}

type UploadedAssetInput struct {
	BlobID   string
	FileName string
}

type CopyNodeInput struct {
	ProjectID    string
	CanvasID     string
	SourceNodeID string
	Position     domaincanvas.Position
}

type CopyNodeResult struct {
	CanvasNode     domaincanvas.CanvasNode
	CanvasNodeNo   int32
	CanvasRevision int64
}

type UpdatePatch struct {
	Content domaincanvas.UpdatePatch
}

func (p UpdatePatch) Empty() bool {
	return p.Content.Empty()
}

type UpdateResult struct {
	CanvasNode   domaincanvas.CanvasNode
	CanvasNodeNo int32
}

type CanvasNodePositionUpdate struct {
	NodeID   string
	Position domaincanvas.Position
}

type BatchUpdatePositionsResult struct {
	Items []domaincanvas.CanvasNode
}

type IDGenerator interface {
	NewID() (string, error)
}

type Clock interface {
	Now() time.Time
}

type StoryboardDraft struct {
	ID              string
	CanvasNodeNo    int
	DurationSeconds int32
	Prompt          string
	AssetReferences []StoryboardAssetReference
}

const StoryboardGenerationProtocolVersion = 3

type StoryboardSourceBeat struct {
	ID   string `json:"source_beat_id"`
	Text string `json:"text"`
}

type StoryboardPlanItem struct {
	Number                int      `json:"canvasnode_no"`
	SourceBeatIDs         []string `json:"source_beat_ids"`
	Summary               string   `json:"summary"`
	TargetDurationSeconds int      `json:"target_duration_seconds"`
	Scene                 string   `json:"scene"`
	ContinuityGroup       string   `json:"continuity_group"`
	Characters            []string `json:"characters"`
	Props                 []string `json:"props"`
	PositionReference     string   `json:"position_reference"`
	AssetRequirements     []string `json:"asset_requirements"`
}

type StoryboardGenerationState struct {
	ProtocolVersion int                    `json:"protocol_version"`
	SourceBeats     []StoryboardSourceBeat `json:"source_beats"`
	Plan            []StoryboardPlanItem   `json:"plan"`
	Completed       []int                  `json:"-"`
	Drafts          []StoryboardDraft      `json:"-"`
}

type StoryboardConstraints struct {
	TenantID                string
	WorkspaceID             string
	CallerID                string
	ProjectID               string
	DurationMinSeconds      int32
	DurationMaxSeconds      int32
	VideoDurationMinSeconds int32
	VideoDurationMaxSeconds int32
	TotalDurationMinSeconds int32
	TotalDurationMaxSeconds int32
	VideoParameters         StoryboardVideoParameters
	AssetLimits             AssetLimits
	AssetCandidates         []StoryboardAssetCandidate
	LoadAssetCandidates     StoryboardAssetCandidateLoader
}

// StoryboardAssetCandidateLoader keeps project-library IO out of the
// latency-critical path. The splitter calls it only after all plain storyboard
// drafts have become visible, before best-effort asset enrichment.
type StoryboardAssetCandidateLoader func(context.Context) ([]StoryboardAssetCandidate, error)

type StoryboardPlanningConfig struct {
	CanvasNodeDurationMinSeconds int32 `json:"canvasnode_duration_min_seconds,omitempty"`
	CanvasNodeDurationMaxSeconds int32 `json:"canvasnode_duration_max_seconds,omitempty"`
	TotalDurationMinSeconds      int32 `json:"total_duration_min_seconds,omitempty"`
	TotalDurationMaxSeconds      int32 `json:"total_duration_max_seconds,omitempty"`
}

type StoryboardAssetCandidate = assetmatching.Candidate

type StoryboardAssetReference struct {
	ResourceAssetID string                `json:"resource_asset_id"`
	TargetField     string                `json:"target_field"`
	AnchorText      string                `json:"anchor_text"`
	AssetID         string                `json:"asset_id,omitempty"`
	Label           string                `json:"label,omitempty"`
	MediaType       domainasset.MediaType `json:"media_type,omitempty"`
}

type StoryboardModelCall struct {
	TaskRunID        string
	Ordinal          int
	ModelID          string
	RequestID        string
	RequestAttempted bool
}

const StoryboardModelCallType = "STORYBOARD_ROUND"

// StoryboardModelCallLedger is the sole authority for model-call ordinals and
// their provider-request lifecycle. Implementations must derive NextOrdinal
// from the same durable ledger updated by Begin and Capture.
type StoryboardModelCallLedger interface {
	NextOrdinal(context.Context, string) (int, error)
	Begin(context.Context, StoryboardModelCall) error
	Capture(context.Context, StoryboardModelCall) error
}

type StoryboardSplitter interface {
	SplitWithState(context.Context, string, applicationmodel.Selection, string, StoryboardConstraints, StoryboardGenerationState, StoryboardModelCallLedger, func(StoryboardGenerationState) error, func(StoryboardDraft) error) error
}

// ProjectAssetCandidate is one current ResourceAsset of a project-owned Resource.
// Name is resource_assets.name and already carries the full entity plus look
// description used for LLM matching, mention labels, and @ search display.
type ProjectAssetCandidate struct {
	Asset           domainasset.Asset
	ResourceAssetID string
	Name            string
	ResourceID      string
	ResourceName    string
	Description     string
	Primary         bool
}

type StoryboardAssetCatalog interface {
	ListProjectAssets(context.Context, Scope, string, int) ([]ProjectAssetCandidate, error)
}

type StoryboardAssetCatalogFailureReporter interface {
	ReportStoryboardAssetCatalogFailure(context.Context, error)
}

type ActiveGenerationCanceller interface {
	CancelActive(context.Context, Scope, domaincanvas.CanvasNode) error
}

type TaskVisibilityHider interface {
	HideByCanvasNodes(context.Context, Scope, []string, time.Time) error
}

type VisibilityFailureReporter interface {
	ReportVisibilityFailure(context.Context, error)
}

type SelectedOutputPreviewer interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type CanvasNodeAssetReader interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type FramePreviewFailureReporter interface {
	ReportFramePreviewFailure(context.Context, string, string, error)
}

// CancellationFailureReporter makes a best-effort cancellation failure
// observable without rolling back an already committed CanvasNode update.
type CancellationFailureReporter interface {
	Report(context.Context, error)
}

type FallbackFrameRepository interface {
	BatchFirstFrameAssets(context.Context, Scope, string, []string) (map[string]FallbackFrameAsset, error)
}

type FallbackFrameAsset struct {
	AssetID   string
	TaskRunID string
}

type FallbackCoverPreviewer interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type FallbackCoverFailureReporter interface {
	ReportFallbackCoverFailure(context.Context, string, string, error)
}
