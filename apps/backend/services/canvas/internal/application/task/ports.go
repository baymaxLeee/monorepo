package task

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	asynccontract "github.com/example/monorepo/canvas/internal/contract/asyncexecution"
	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

var (
	ErrNotFound                          = errors.New("task run not found")
	ErrInvalidTaskHierarchy              = errors.New("task run hierarchy is invalid")
	ErrInvalidAsyncExecutionEventPayload = errors.New("invalid async execution event payload")
)

type Scope struct {
	TenantID    string
	WorkspaceID *string
}

type TaskRunStore interface {
	Create(context.Context, domain.TaskRun) error
	GetTaskRun(context.Context, string) (domain.TaskRun, error)
	Get(context.Context, Scope, domain.RunType, domain.SubjectType, string, string) (domain.TaskRun, error)
	UpdateTaskRun(context.Context, domain.TaskRun, TaskRunUpdate, time.Time) (bool, error)
	HideTaskRunsBySubjects(context.Context, Scope, domain.RunType, domain.SubjectType, []string, time.Time) error
}

type TaskRunHierarchyReader interface {
	ListTaskRunsByRoot(context.Context, Scope, string) ([]domain.TaskRun, error)
	ListTaskRunsByParent(context.Context, Scope, string) ([]domain.TaskRun, error)
}

type TaskRunUpdate struct {
	Status                  domain.Status
	ErrorCode, ErrorMessage string
	StartedAt, FinishedAt   *time.Time
}

type TaskRunReader interface {
	GetTaskRun(context.Context, string) (domain.TaskRun, error)
	CanExecuteTaskRun(context.Context, domain.TaskRun) (bool, error)
}

// TaskRunBatchReader is the request-scoped read boundary used by batch status APIs.
type TaskRunBatchReader interface {
	BatchGetTaskRuns(context.Context, Scope, []string) ([]domain.TaskRun, error)
}

// ScopedTaskRunBatchReader is the trusted application boundary for reading
// task runs within a tenant and workspace regardless of user visibility.
type ScopedTaskRunBatchReader interface {
	BatchGetScopedTaskRuns(context.Context, Scope, []string) ([]domain.TaskRun, error)
}

type TaskRunSubject struct {
	RunType     domain.RunType
	SubjectType domain.SubjectType
	SubjectID   string
}

// LatestTaskRunBatchReader loads the latest visible run for each requested
// subject without expanding a graph read into per-node history queries.
type LatestTaskRunBatchReader interface {
	BatchGetLatestTaskRunsBySubjects(context.Context, Scope, []TaskRunSubject) ([]domain.TaskRun, error)
}

type PollScheduleStore interface {
	CreatePollSchedule(context.Context, domain.PollSchedule) error
	ClaimDuePollSchedules(context.Context, domain.RunType, time.Time, time.Time, int) ([]domain.PollSchedule, error)
	RenewPollSchedule(context.Context, domain.PollSchedule, time.Time, time.Time) (bool, error)
	ReschedulePoll(context.Context, domain.PollSchedule, domain.PollScheduleUpdate, time.Time) (bool, error)
	CompletePollSchedule(context.Context, domain.PollSchedule) (bool, error)
	DeletePollSchedule(context.Context, string) error
}

type AsyncDispatchStore interface {
	ClaimDueAsyncDispatches(context.Context, time.Time, time.Time, int) ([]domain.AsyncDispatch, error)
	MarkAsyncDispatchDelivered(context.Context, domain.AsyncDispatch, time.Time) (bool, error)
	MarkAsyncDispatchFailurePending(context.Context, domain.AsyncDispatch, string, string, time.Time) (domain.AsyncDispatch, bool, error)
	RescheduleAsyncDispatch(context.Context, domain.AsyncDispatch, time.Time, string, string, time.Time) (domain.AsyncDispatch, bool, error)
	CompleteAsyncExecution(context.Context, domain.AsyncDispatch) (bool, error)
	DeleteAsyncDispatch(context.Context, string) error
}

type AsyncPublisher interface {
	Publish(context.Context, string, any) error
}

type AsyncExecutionStore interface {
	ClaimAsyncExecution(context.Context, string, string, time.Time, time.Time) (domain.AsyncDispatch, bool, error)
	HeartbeatAsyncExecution(context.Context, domain.AsyncDispatch, time.Time, time.Time) (domain.AsyncDispatch, bool, error)
	ReleaseAsyncExecution(context.Context, domain.AsyncDispatch, time.Time, string, string, time.Time) (domain.AsyncDispatch, bool, error)
	CompleteAsyncExecution(context.Context, domain.AsyncDispatch) (bool, error)
}

type AsyncExecutionEventStore interface {
	CreateAsyncExecutionEvent(context.Context, asynccontract.Event) error
	ClaimDueAsyncExecutionEvents(context.Context, time.Time, time.Time, int) ([]asynccontract.Event, error)
	HasUnfinishedAsyncExecutionEventBefore(context.Context, string, int32) (bool, error)
	MarkAsyncExecutionEventConsumed(context.Context, asynccontract.Event, time.Time) (bool, error)
	DiscardAsyncExecutionEvent(context.Context, asynccontract.Event, time.Time) (bool, error)
	RescheduleAsyncExecutionEvent(context.Context, asynccontract.Event, time.Time, string, string, time.Time) (bool, error)
}

type AsyncExecutionEventRunStore interface {
	GetTaskRun(context.Context, string) (domain.TaskRun, error)
	CanExecuteTaskRun(context.Context, domain.TaskRun) (bool, error)
}

type AsyncExecutionEventDispatchStore interface {
	GetAsyncDispatch(context.Context, string) (domain.AsyncDispatch, error)
	RetryAsyncExecution(context.Context, domain.AsyncDispatch, time.Time, string, string, time.Time) (domain.AsyncDispatch, bool, error)
	CompleteAsyncExecution(context.Context, domain.AsyncDispatch) (bool, error)
}

type AsyncExecutionEventProcessor interface {
	RunType() string
	RecordCheckpoint(context.Context, string, json.RawMessage) error
	CommitSuccess(context.Context, string, json.RawMessage) error
	CommitFailure(context.Context, string) error
}

type IDGenerator interface{ NewID() (string, error) }

type AsyncExecutionStarter interface {
	RunType() domain.RunType
	MarkStarted(context.Context, domain.TaskRun, domain.AsyncDispatch, time.Time) error
}

type PollProcessor interface {
	RunType() domain.RunType
	ProcessPollClaim(context.Context, domain.TaskRun, domain.PollSchedule) error
}

type TransactionManager interface {
	WithinTransaction(context.Context, func(context.Context) error) error
}

type Clock interface{ Now() time.Time }
