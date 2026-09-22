package videogeneration

import (
	"context"
	"errors"
	"time"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvasnode "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
)

var (
	ErrNotFound                            = errors.New("canvasnode video generation not found")
	ErrReferenceUnavailable                = errors.New("canvas canvasnode asset reference is unavailable to AIGW")
	ErrCanvasNodeVideoProviderTaskNotFound = errors.New("canvasnode video provider task not found")
	ErrHistoryNotSelectable                = errors.New("canvas canvasnode history is not selectable")
)

type Scope = applicationcanvasnode.Scope

type CanvasNodeStore interface {
	List(context.Context, Scope, string, string) ([]domaincanvasnode.CanvasNode, error)
	Get(context.Context, Scope, string, string, string) (domaincanvasnode.CanvasNode, error)
	GetByID(context.Context, Scope, string) (domaincanvasnode.CanvasNode, error)
	ClaimTaskRun(context.Context, domaincanvasnode.CanvasNode) (bool, error)
	ReleaseTaskRun(context.Context, domaincanvasnode.CanvasNode, string) (bool, error)
}

type ReferenceResolver interface {
	PublicReferenceURL(context.Context, string, string, domainasset.Asset) (string, error)
}

type CanvasNodeVideoReference struct {
	MediaType domainasset.MediaType
	URL       string
	Role      string
}
type resolvedNodeReference struct {
	NodeID       string
	Asset        domainasset.Asset
	ReferenceURL string
	Role         string
	Text         string
	Input        domaingenerationinput.Input
}

type resolvedGenerationInputs struct {
	Prompt     string
	References []resolvedNodeReference
}
type CanvasNodeVideoProviderIdentity struct{ TenantID, CallerID, WorkspaceID, ProjectID, ModelID string }
type SubmitCanvasNodeVideoInput struct {
	Model, Prompt, Resolution, Ratio string
	TaskRunID                        string
	CallOrdinal                      int
	Identity                         CanvasNodeVideoProviderIdentity
	DurationSeconds                  int64
	GenerateAudio, Watermark         bool
	References                       []CanvasNodeVideoReference
}
type CanvasNodeVideoCall struct {
	TaskRunID        string
	Ordinal          int
	ModelID          string
	RequestID        string
	RequestAttempted bool
}
type SubmitCanvasNodeVideoResult struct {
	TaskID string
	Call   CanvasNodeVideoCall
}
type CanvasNodeVideoProviderTask struct {
	ID, SeedanceTaskID                string
	VideoURL, ErrorCode, ErrorMessage string
	Status                            domainvideo.ProviderStatus
	OutputDurationSeconds             *int32
}
type CanvasNodeVideoProvider interface {
	Submit(context.Context, SubmitCanvasNodeVideoInput) (SubmitCanvasNodeVideoResult, error)
	Get(context.Context, CanvasNodeVideoProviderIdentity, string) (CanvasNodeVideoProviderTask, error)
	Cancel(context.Context, CanvasNodeVideoProviderIdentity, string) error
}
type CanvasNodeVideoPollObservation struct {
	Status                                             domainvideo.ProviderStatus
	ResultRef, ErrorCode, ErrorMessage, SeedanceTaskID string
	OutputDurationSeconds                              *int32
}
type CanvasNodeVideoPollEventKind string

const (
	CanvasNodeVideoPollEventSubmissionInterrupted CanvasNodeVideoPollEventKind = "submission_interrupted"
	CanvasNodeVideoPollEventDeadlineExceeded      CanvasNodeVideoPollEventKind = "deadline_exceeded"
	CanvasNodeVideoPollEventProviderError         CanvasNodeVideoPollEventKind = "provider_error"
	CanvasNodeVideoPollEventProviderTaskNotFound  CanvasNodeVideoPollEventKind = "provider_task_not_found"
	CanvasNodeVideoPollEventTargetMissing         CanvasNodeVideoPollEventKind = "target_missing"
	CanvasNodeVideoPollEventProviderResult        CanvasNodeVideoPollEventKind = "provider_result"
	CanvasNodeVideoPollEventFinalize              CanvasNodeVideoPollEventKind = "finalize"
)

type CanvasNodeVideoPollEvent struct {
	Kind                   CanvasNodeVideoPollEventKind
	Task                   CanvasNodeVideoPollObservation
	PreviousProviderStatus domainvideo.ProviderStatus
	Error                  error
}
type CanvasNodeVideoResultInput struct {
	TaskRunID, TenantID, CallerID, ProjectID, SourceURL string
	WorkspaceID                                         *string
}
type PersistedCanvasNodeVideo struct {
	ArtifactID        string
	ArtifactNamespace string
	SizeBytes         int64
}
type CanvasNodeVideoResultStore interface {
	Persist(context.Context, CanvasNodeVideoResultInput) (PersistedCanvasNodeVideo, error)
}

type CanvasNodeVideoPollResult struct {
	TerminalStatus                          domaintask.Status
	ProviderStatus                          domainvideo.ProviderStatus
	ErrorMessage                            string
	ProviderErrorCode, ProviderErrorMessage string
	SeedanceTaskID                          string
	NextPollingAt, DeadlineAt               *time.Time
	ProviderError                           bool
	FinishedAt                              *time.Time
	OutputDurationSeconds                   *int32
}
type GenerationUpdate struct {
	Status, AssetID, ErrorMessage string
	CompletedAt                   *time.Time
	UpdatedAt                     time.Time
}

type FailedProviderFacts struct {
	ErrorCode, SeedanceTaskID string
}
type GenerationStore interface {
	CreateGeneration(context.Context, domainvideo.Generation) error
	GetGeneration(context.Context, Scope, string) (domainvideo.Generation, error)
	GetVisibleGeneration(context.Context, Scope, string) (domainvideo.Generation, error)
	UpdateGeneration(context.Context, string, GenerationUpdate) error
	AttachFirstLastFrameTask(context.Context, string, string, time.Time) (bool, error)
	ListGenerations(context.Context, Scope, string, string, string) ([]domainvideo.Generation, error)
	SelectGeneration(context.Context, Scope, string, string, string, string, string, time.Time) (domainvideo.Generation, error)
	MarkGenerationSubmitted(context.Context, string, string, time.Time) error
	UpdateGenerationProviderObservation(context.Context, string, domainvideo.ProviderStatus, string, *int32, string, string, string, time.Time) error
	HideGenerations(context.Context, Scope, []string, time.Time) ([]string, error)
}

type TaskRun struct {
	TaskRunID, TenantID, ProjectID, CanvasID, NodeID string
	CallerID                                         string
	WorkspaceID                                      *string
	Status, VideoURL, ErrorCode, ErrorMessage        string
	FirstFrameAssetID, LastFrameAssetID              string
	FirstFrameURL, LastFrameURL                      string
	Inputs                                           []domaingenerationinput.Input
	ProviderStatus                                   domainvideo.ProviderStatus
	ProviderTaskID                                   string
	SeedanceTaskID                                   string
	NodeType                                         domaincanvasnode.NodeType
	OutputAssetID                                    string
	OutputText                                       string
	ModelServiceID, Prompt                           string
	Resolution                                       domainvideo.Resolution
	AspectRatio                                      domainvideo.AspectRatio
	DurationSeconds                                  int32
	GenerateAudio, Watermark                         bool
	StateVersion                                     int64
	CreatedAt, UpdatedAt                             time.Time
	FinishedAt                                       *time.Time
}

type TaskRunStore = applicationtask.TaskRunStore
type TaskRunUpdate = applicationtask.TaskRunUpdate
type PollScheduleStore = applicationtask.PollScheduleStore
type AsyncDispatchStore interface {
	CreateAsyncDispatch(context.Context, domaintask.AsyncDispatch) error
}
type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }
type TargetFailureReporter interface {
	ReportTargetFailure(context.Context, domaintask.TaskRun, error)
}
type FramePreviewFailureReporter interface {
	ReportFramePreviewFailure(context.Context, string, string, error)
}
