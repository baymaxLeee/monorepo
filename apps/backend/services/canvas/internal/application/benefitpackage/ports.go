package benefitpackage

import (
	"context"
	"errors"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

var (
	ErrReviewStateConflict      = errors.New("asset review state conflict")
	ErrReviewNotFound           = errors.New("asset review not found")
	ErrAssetReviewRateLimited   = errors.New("asset review provider rate limited")
	ErrAssetReviewQuotaExceeded = errors.New("asset review provider quota exceeded")
)

// AssetReviewProviderError retains only safe provider diagnostics. Credentials,
// signed URLs, request payloads, and raw provider responses must never be added.
type AssetReviewProviderError struct {
	Cause     error
	Code      string
	RequestID string
}

func (e *AssetReviewProviderError) Error() string {
	if e == nil {
		return ""
	}
	if e.Cause == nil {
		return "asset review provider error"
	}
	return e.Cause.Error()
}

func (e *AssetReviewProviderError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }

type ReviewScope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type BenefitPackage struct {
	ID, Name string
	IsPreset bool
	ModelIDs []string
}

type ReviewReservation struct {
	ID, Status string
}

type ProviderAssetStatus string

const (
	ProviderAssetProcessing ProviderAssetStatus = "Processing"
	ProviderAssetActive     ProviderAssetStatus = "Active"
	ProviderAssetFailed     ProviderAssetStatus = "Failed"
)

type ReviewedAsset struct {
	ID            string
	Status        ProviderAssetStatus
	FailureReason string
}

type ReviewCleanup struct {
	CleanupID, ReservationID, Status string
}

type ReviewGateway interface {
	ListBenefitPackages(context.Context, string, string) ([]BenefitPackage, error)
	ReserveBenefitPackageReview(context.Context, string, string, string, string, string, string) (ReviewReservation, error)
	TransitionBenefitPackageReview(context.Context, string, string, string, string, string) (ReviewReservation, error)
	SubmitReviewedAsset(context.Context, string, string, string, string, string, string) (ReviewedAsset, error)
	GetReviewedAsset(context.Context, string, string, string, string) (ReviewedAsset, error)
	BeginBenefitPackageReviewCleanup(context.Context, string, string, string, string, string) (ReviewCleanup, error)
	CompleteBenefitPackageReviewCleanup(context.Context, string, string, string, string, string) (ReviewCleanup, error)
	DeleteReviewedAsset(context.Context, string, string, string, string) error
}

type AssetReviewRecord struct {
	ID, TaskRunID, TenantID, ProjectID, PackageID, PackageName, AssetID string
	ProviderAssetID, FailureReason, ReservationID                       string
	WorkspaceID                                                         *string
	ModelIDs                                                            []string
	SystemPresetModels                                                  bool
	Status                                                              domainasset.ReviewStatus
	SubmittedAt, SubmissionStartedAt                                    *time.Time
	CreatedAt, UpdatedAt                                                time.Time
}

type ReserveAssetReviewInput struct {
	ID, TaskRunID, TenantID, ProjectID, PackageID, PackageName, AssetID string
	WorkspaceID                                                         *string
	ModelIDs                                                            []string
	SystemPresetModels                                                  bool
	Now                                                                 time.Time
}

type ReplaceAssetReviewResult struct {
	Current  AssetReviewRecord
	Replaced []AssetReviewRecord
}

type AssetReviewRepository interface {
	ReplaceAssetReview(context.Context, ReserveAssetReviewInput) (ReplaceAssetReviewResult, error)
	SetAssetReviewReservation(context.Context, string, string, time.Time) error
	MarkAssetReviewSubmissionStarted(context.Context, string, string, time.Time) error
	ResetAssetReviewSubmission(context.Context, string, string, string, time.Time) error
	MarkAssetReviewProcessing(context.Context, string, string, string, time.Time) error
	MarkAssetReviewFailed(context.Context, string, string, time.Time) error
	GetAssetReviewByTaskRun(context.Context, string) (AssetReviewRecord, error)
	MarkAssetReviewTerminal(context.Context, string, domainasset.ReviewStatus, string, time.Time) error
}

type ProjectAssetReviewReader interface {
	BatchGetProjectAssetReviews(context.Context, ReviewScope, string, []string) (map[string][]domainasset.Review, error)
}

type AssetReviewCleanupRepository interface {
	RetireAssetReviews(context.Context, applicationasset.Scope, string, time.Time) ([]AssetReviewRecord, error)
}

type ReviewAssetStore interface {
	BypassBatchGet(context.Context, applicationasset.BypassBatchGetInput) ([]domainasset.Asset, error)
	CreateIdempotent(context.Context, applicationasset.CreateInput) (domainasset.Asset, bool, error)
}

type AssetReferenceResolver interface {
	PublicReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
}

type AssetProjectValidator interface {
	ValidateReviewAsset(context.Context, ReviewScope, string, string, string) error
}

type ReviewTaskStore interface {
	applicationtask.TaskRunStore
	applicationtask.PollScheduleStore
	GetTaskRunForUpdate(context.Context, string) (domaintask.TaskRun, error)
}

type ReviewCleanupTaskStore interface {
	GetTaskRunForUpdate(context.Context, string) (domaintask.TaskRun, error)
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
	DeletePollSchedule(context.Context, string) error
}

type ReviewCleanupOutbox struct {
	ReviewID, AssetID, PackageID, TenantID, ProviderAssetID, ReservationID string
	WorkspaceID                                                            *string
	Status                                                                 string
	NextAttemptAt, CreatedAt, UpdatedAt                                    time.Time
	LeaseUntil                                                             *time.Time
	StateVersion                                                           int64
	Attempts                                                               int32
	LastError                                                              string
}

type ReviewCleanupOutboxRepository interface {
	ClaimReviewCleanup(context.Context, time.Time, time.Time, int) ([]ReviewCleanupOutbox, error)
	CompleteReviewCleanup(context.Context, ReviewCleanupOutbox, time.Time) (bool, error)
	RescheduleReviewCleanup(context.Context, ReviewCleanupOutbox, time.Time, string, time.Time) (bool, error)
	MarkReviewCleanupDead(context.Context, ReviewCleanupOutbox, string, time.Time) (bool, error)
}

const (
	ReviewCleanupStatusPending = "pending"
	ReviewCleanupStatusDead    = "dead"
)

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type TaskRun = domaintask.TaskRun
