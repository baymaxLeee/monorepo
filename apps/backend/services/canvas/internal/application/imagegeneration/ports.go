package imagegeneration

import (
	"context"
	"errors"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

var (
	ErrNotFound               = errors.New("image generation not found")
	ErrRunConflict            = errors.New("image generation task run conflict")
	ErrTargetHandlerNotFound  = errors.New("image generation target handler not found")
	ErrDuplicateTargetHandler = errors.New("duplicate image generation target handler")
)

type Scope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type StartInput struct {
	Scope
	ProjectID        string
	TargetType       domainimagegeneration.TargetType
	TargetID         string
	ExpectedRevision int64
	ModelName        string
	ModelSource      string
}

type CancelInput struct {
	Scope
	TargetType domainimagegeneration.TargetType
	TargetID   string
	TaskRunID  string
}

type GetRunInput struct {
	Scope
	TargetType domainimagegeneration.TargetType
	TargetID   string
	TaskRunID  string
}

type ProviderInput struct {
	TenantID, CallerID string
	ProjectID          string
	WorkspaceID        *string
	TaskRunID          string
	CallOrdinal        int
	ModelID, Prompt    string
	Resolution         domainimagegeneration.Resolution
	AspectRatio        domainimagegeneration.AspectRatio
	Watermark          bool
	ReferenceURLs      []string
}

type ProviderCall struct {
	TaskRunID        string
	Ordinal          int
	ModelID          string
	RequestID        string
	RequestAttempted bool
}

type ProviderResult struct {
	SourceURL string
	Call      ProviderCall
}

// ProviderFailure carries the provider's structured code and message without
// translating them. Cause remains internal and is not projected to clients.
type ProviderFailure struct {
	Code    string
	Message string
	Cause   error
}

func (failure *ProviderFailure) Error() string {
	if failure == nil {
		return "image generation failed"
	}
	if failure.Message != "" {
		return failure.Message
	}
	if failure.Code != "" {
		return failure.Code
	}
	return "image generation failed"
}

func (failure *ProviderFailure) Unwrap() error {
	if failure == nil {
		return nil
	}
	return failure.Cause
}

type Provider interface {
	Generate(context.Context, ProviderInput) (ProviderResult, error)
}

type TaskStore interface {
	Create(context.Context, domaintask.TaskRun) error
	CreatePollSchedule(context.Context, domaintask.PollSchedule) error
	GetTaskRunForUpdate(context.Context, string) (domaintask.TaskRun, error)
	GetTaskRun(context.Context, string) (domaintask.TaskRun, error)
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
	DeletePollSchedule(context.Context, string) error
}

type TaskVisibilityStore interface {
	HideTaskRunsBySubjects(context.Context, applicationtask.Scope, domaintask.RunType, domaintask.SubjectType, []string, time.Time) error
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type AssetReferenceTracker interface {
	AcquireAssets(context.Context, applicationasset.AcquireAssetsInput) error
	ReleaseAllAssets(context.Context, applicationasset.ReleaseAllAssetsInput) error
}

type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }

type StartTarget struct {
	Scope
	ProjectID        string
	TargetType       domainimagegeneration.TargetType
	TargetID         string
	ExpectedRevision int64
}

type TargetHandler interface {
	TargetType() domainimagegeneration.TargetType
	PrepareStart(context.Context, StartTarget, string) (domainimagegeneration.RunSpec, error)
	BindResult(context.Context, domainimagegeneration.Run, string) (domainimagegeneration.BindingOutcome, error)
	FailRun(context.Context, domainimagegeneration.Run) error
	ReleaseRun(context.Context, domainimagegeneration.Run) error
}

type EngineRunStore interface {
	CreateRun(context.Context, domainimagegeneration.Run) error
	GetRun(context.Context, Scope, string) (domainimagegeneration.Run, error)
	ListRuns(context.Context, Scope, domainimagegeneration.TargetType, string) ([]domainimagegeneration.Run, error)
	ListRunIDsByTargets(context.Context, Scope, domainimagegeneration.TargetType, []string) ([]string, error)
	SaveRun(context.Context, domainimagegeneration.Run) error
}
