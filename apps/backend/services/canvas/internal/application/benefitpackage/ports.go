package benefitpackage

import (
	"context"
	"errors"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainpackage "github.com/example/monorepo/canvas/internal/domain/benefitpackage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

var (
	ErrNotFound                 = errors.New("benefit package not found")
	ErrNameConflict             = errors.New("benefit package name conflict")
	ErrModelConflict            = errors.New("benefit package model conflict")
	ErrRevisionConflict         = errors.New("benefit package revision conflict")
	ErrPresetImmutable          = errors.New("preset benefit package cannot be deleted")
	ErrPackageTypeMismatch      = errors.New("benefit package type mismatch")
	ErrReviewStateConflict      = errors.New("asset review state conflict")
	ErrReviewNotFound           = errors.New("asset review not found")
	ErrAssetReviewAuthorization = errors.New("asset review provider authorization failed")
	ErrAssetReviewRateLimited   = errors.New("asset review provider rate limited")
)

type Scope struct {
	TenantID string
	CallerID string
}

type Repository interface {
	Create(context.Context, domainpackage.Package) error
	Get(context.Context, Scope, string) (domainpackage.Package, error)
	Update(context.Context, domainpackage.Package, int64) error
	Delete(context.Context, domainpackage.Package, int64, bool) ([]AssetReviewRecord, error)
	List(context.Context, Scope) ([]domainpackage.Package, error)
}

type PackageDeletion interface {
	DeletePackage(context.Context, domainpackage.Package, int64, bool) error
}

type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }
type CredentialCipher interface {
	Encrypt(string, string) (string, error)
	Decrypt(string, string) (string, error)
}

type CreateAssetGroupInput struct {
	Name, ProjectName, AccessKeyID, SecretAccessKey string
}

type DeleteAssetGroupInput struct {
	AssetGroupID, ProjectName, AccessKeyID, SecretAccessKey string
}

type AssetGroupGateway interface {
	CreateAssetGroup(context.Context, CreateAssetGroupInput) (string, error)
	DeleteAssetGroup(context.Context, DeleteAssetGroupInput) error
}

type AssetGroupCleanupFailureReporter interface {
	ReportAssetGroupCleanupFailure(context.Context, string, string, error)
}

type ReviewScope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type AssetReviewRecord struct {
	ID, TaskRunID, TenantID, ProjectID, PackageID, PackageName, AssetID string
	ProviderAssetID, FailureReason, QuotaReservationID                  string
	WorkspaceID                                                         *string
	Status                                                              domainasset.ReviewStatus
	ScopeType                                                           domainpackage.ScopeType
	SubmittedAt, SubmissionStartedAt                                    *time.Time
	CreatedAt, UpdatedAt                                                time.Time
}

type ReserveAssetReviewInput struct {
	ID, TaskRunID, TenantID, ProjectID, PackageID, PackageName, AssetID string
	WorkspaceID                                                         *string
	ScopeType                                                           domainpackage.ScopeType
	Now                                                                 time.Time
}

type ReplaceAssetReviewResult struct {
	Current  AssetReviewRecord
	Replaced []AssetReviewRecord
}

type AssetReviewRepository interface {
	ReplaceAssetReview(context.Context, ReserveAssetReviewInput) (ReplaceAssetReviewResult, error)
	SetAssetReviewQuotaReservation(context.Context, string, string, time.Time) error
	MarkAssetReviewSubmissionStarted(context.Context, string, string, time.Time) error
	ResetAssetReviewSubmission(context.Context, string, string, time.Time) error
	MarkAssetReviewProcessing(context.Context, string, string, string, time.Time) error
	MarkAssetReviewFailed(context.Context, string, string, time.Time) error
	GetAssetReviewByTaskRun(context.Context, string) (AssetReviewRecord, error)
	MarkAssetReviewTerminal(context.Context, string, domainasset.ReviewStatus, string, time.Time) error
}

type ProjectAssetReviewReader interface {
	// BatchGetProjectAssetReviews returns the current submission for each asset and package pair, capped at 200 reviews.
	BatchGetProjectAssetReviews(context.Context, ReviewScope, string, []string) (map[string][]domainasset.Review, error)
}

type AssetReviewCleanupRepository interface {
	RetireAssetReviews(context.Context, applicationasset.Scope, string, time.Time) ([]AssetReviewRecord, error)
	Delete(context.Context, domainpackage.Package, int64, bool) ([]AssetReviewRecord, error)
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

type CreateReviewedAssetInput struct {
	AssetGroupID, URL, AssetType, Name, ProjectName, AccessKeyID, SecretAccessKey string
}

type GetReviewedAssetInput struct {
	ProviderAssetID, ProjectName, AccessKeyID, SecretAccessKey string
}

type DeleteReviewedAssetInput struct {
	ProviderAssetID, ProjectName, AccessKeyID, SecretAccessKey string
}

type ProviderAssetStatus string

const (
	ProviderAssetProcessing ProviderAssetStatus = "Processing"
	ProviderAssetActive     ProviderAssetStatus = "Active"
	ProviderAssetFailed     ProviderAssetStatus = "Failed"
)

type ReviewedAsset struct {
	Status        ProviderAssetStatus
	FailureReason string
}

type AssetReviewGateway interface {
	CreateAsset(context.Context, CreateReviewedAssetInput) (string, error)
	GetAsset(context.Context, GetReviewedAssetInput) (ReviewedAsset, error)
	DeleteAsset(context.Context, DeleteReviewedAssetInput) error
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
	ReviewID, AssetID, PackageID, TenantID, ProviderAssetID, ProjectName string
	EncryptedAccessKeyID, EncryptedSecretAccessKey, LastError            string
	QuotaReservationID                                                   string
	Status                                                               string
	NextAttemptAt, CreatedAt, UpdatedAt                                  time.Time
	LeaseUntil                                                           *time.Time
	StateVersion                                                         int64
	Attempts                                                             int32
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

type ReviewQuota interface {
	ReservePresetEntitlement(context.Context, string, string, string, string) (applicationquota.Reservation, error)
	CommitReservation(context.Context, applicationquota.Reservation) error
	ReleaseReservation(context.Context, applicationquota.Reservation) error
	BeginPresetEntitlementRelease(context.Context, string) error
	CompletePresetEntitlementCleanup(context.Context, string) (bool, error)
}

type TaskRun = domaintask.TaskRun
