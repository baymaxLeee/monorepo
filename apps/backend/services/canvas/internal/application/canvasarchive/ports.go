package canvasarchive

import (
	"context"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type Repository interface {
	Create(context.Context, Export, []Input) error
	Get(context.Context, Scope, string, string, string) (Export, error)
	BatchGet(context.Context, Scope, string, string, []string) ([]Export, error)
	List(context.Context, ListQuery) ([]Export, int64, error)
	FindActive(context.Context, Scope, string, string) (Export, error)
}

type CanvasAccessValidator interface {
	Validate(context.Context, Scope, string, string) error
}

type SelectedVideoSnapshotStore interface {
	SnapshotSelectedVideos(context.Context, Scope, string, string) ([]SelectedVideo, error)
}

type TaskRunStore interface {
	Create(context.Context, domaintask.TaskRun) error
}

type AsyncDispatchStore interface {
	CreateAsyncDispatch(context.Context, domaintask.AsyncDispatch) error
}

type LifecycleStore interface {
	UpdateLifecycle(context.Context, string, domaintask.Status, LifecycleUpdate, time.Time) (bool, error)
}

type ExecutionStore interface {
	GetByTaskRunID(context.Context, string) (Export, error)
	ListInputs(context.Context, string) ([]Input, error)
	RecordOutput(context.Context, string, domaintask.Status, SuccessResult, time.Time) (bool, error)
	CommitSuccess(context.Context, string, domaintask.Status, SuccessResult, time.Time, time.Time) (bool, error)
}

type ExecutionTaskStore interface {
	GetTaskRun(context.Context, string) (domaintask.TaskRun, error)
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
}

type TaskRunLifecycleStore interface {
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
}

type TaskRunCancellationStore interface {
	GetTaskRun(context.Context, string) (domaintask.TaskRun, error)
	UpdateTaskRun(context.Context, domaintask.TaskRun, applicationtask.TaskRunUpdate, time.Time) (bool, error)
}

type AsyncDispatchDeleteStore interface {
	DeleteAsyncDispatch(context.Context, string) error
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type ClaimIntentStore interface {
	EnsureActive(context.Context, applicationassetclaim.Intent, time.Time) error
	EnsureReleased(context.Context, applicationassetclaim.Intent, time.Time) error
}

type StorageQuota interface {
	CheckStorageAdmission(context.Context, string) error
	RecordAdmittedStorage(context.Context, applicationquota.StorageObject) error
}

type CleanupStorageQuota interface {
	MarkStorageReleasing(context.Context, string, string) (bool, error)
	ReleaseStorage(context.Context, string, string) (bool, error)
	ReleaseReservation(context.Context, applicationquota.Reservation) error
}

type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }
