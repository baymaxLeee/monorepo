package task

import (
	"encoding/json"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type taskRunRow struct {
	ID           persistenceid.UUID  `gorm:"primaryKey;index:idx_task_runs_creator_updated,priority:6,sort:desc"`
	TenantID     string              `gorm:"size:64;not null;index:idx_task_runs_subject,priority:1;index:idx_task_runs_creator_updated,priority:1;index:idx_task_runs_root_created,priority:1;index:idx_task_runs_parent_created,priority:1"`
	WorkspaceID  *string             `gorm:"size:64;index:idx_task_runs_subject,priority:2;index:idx_task_runs_creator_updated,priority:2;index:idx_task_runs_root_created,priority:2;index:idx_task_runs_parent_created,priority:2"`
	RootTaskID   *persistenceid.UUID `gorm:"index:idx_task_runs_root_created,priority:3"`
	ParentTaskID *persistenceid.UUID `gorm:"index:idx_task_runs_parent_created,priority:3"`
	CreatedBy    string              `gorm:"size:64;not null;index:idx_task_runs_creator_updated,priority:3"`
	RunType      string              `gorm:"size:64;not null;index:idx_task_runs_subject,priority:3"`
	SubjectType  string              `gorm:"size:64;not null;index:idx_task_runs_subject,priority:4"`
	SubjectID    string              `gorm:"size:64;not null;index:idx_task_runs_subject,priority:5"`
	IsInternal   bool                `gorm:"not null;default:false;index:idx_task_runs_creator_updated,priority:4"`
	HiddenAt     *time.Time
	Status       string `gorm:"size:32;not null"`
	ErrorCode    string `gorm:"size:128;not null"`
	ErrorMessage string `gorm:"type:text;not null"`
	StateVersion int64  `gorm:"not null"`
	StartedAt    *time.Time
	FinishedAt   *time.Time
	CreatedAt    time.Time `gorm:"not null;index:idx_task_runs_root_created,priority:4;index:idx_task_runs_parent_created,priority:4"`
	UpdatedAt    time.Time `gorm:"not null;index:idx_task_runs_creator_updated,priority:5,sort:desc"`
}

func (taskRunRow) TableName() string { return "task_runs" }

type pollScheduleRow struct {
	TaskRunID         persistenceid.UUID `gorm:"primaryKey;index:idx_poll_schedules_due,priority:2"`
	NextPollAt        time.Time          `gorm:"not null;index:idx_poll_schedules_due,priority:1"`
	LeaseUntil        *time.Time
	StateVersion      int64     `gorm:"not null"`
	PollAttempts      int32     `gorm:"not null"`
	ConsecutiveErrors int32     `gorm:"not null"`
	DeadlineAt        time.Time `gorm:"not null"`
	CreatedAt         time.Time `gorm:"not null"`
	UpdatedAt         time.Time `gorm:"not null"`
}

func (pollScheduleRow) TableName() string { return "poll_schedules" }

type asyncDispatchRow struct {
	TaskRunID persistenceid.UUID `gorm:"primaryKey;index:idx_async_dispatches_due,priority:3"`
	RunType   string             `gorm:"size:64;not null"`
	// Topic remains a derived persistence column because GORM AutoMigrate does not
	// drop the earlier NOT NULL column. Routing must never read this value.
	Topic string `gorm:"size:191;not null"`
	// These columns remain nullable in the schema inherited from the pre-Job
	// migration owner. Runtime writes still always provide concrete values.
	DeliveryState       string    `gorm:"size:32;index:idx_async_dispatches_due,priority:1"`
	ExecutionState      string    `gorm:"size:32;index:idx_async_dispatches_execution_due,priority:1"`
	NextDispatchAt      time.Time `gorm:"not null;index:idx_async_dispatches_due,priority:2"`
	PublishLeaseUntil   *time.Time
	ExecutionLeaseUntil *time.Time `gorm:"index:idx_async_dispatches_execution_due,priority:2"`
	ExecutionToken      string     `gorm:"size:36;not null"`
	DeliveryVersion     int64
	ExecutionVersion    int64
	PublishAttempts     int32 `gorm:"not null"`
	ExecutionAttempts   int32 `gorm:"not null"`
	ExecutionFailures   int32 `gorm:"not null"`
	LeaseRecoveries     int32 `gorm:"not null"`
	FirstStartedAt      *time.Time
	LastErrorCode       string    `gorm:"size:128;not null"`
	LastErrorMessage    string    `gorm:"type:text;not null"`
	CreatedAt           time.Time `gorm:"not null"`
	UpdatedAt           time.Time `gorm:"not null"`
}

func (asyncDispatchRow) TableName() string { return "async_dispatches" }

type asyncExecutionEventRow struct {
	ID                persistenceid.UUID `gorm:"primaryKey"`
	TaskRunID         persistenceid.UUID `gorm:"not null;index"`
	RunType           string             `gorm:"size:64;not null"`
	ExecutionToken    string             `gorm:"size:36;not null;uniqueIndex:idx_async_execution_events_sequence,priority:1;uniqueIndex:idx_async_execution_events_terminal,priority:1"`
	Sequence          int32              `gorm:"not null;uniqueIndex:idx_async_execution_events_sequence,priority:2"`
	EventType         string             `gorm:"size:32;not null"`
	PayloadVersion    int32              `gorm:"not null"`
	Payload           json.RawMessage    `gorm:"type:json;not null"`
	PayloadSHA256     string             `gorm:"size:64;not null"`
	TerminalSlot      *int8              `gorm:"uniqueIndex:idx_async_execution_events_terminal,priority:2"`
	ConsumeStatus     string             `gorm:"size:32;not null;index:idx_async_execution_events_due,priority:1"`
	NextConsumeAt     time.Time          `gorm:"not null;index:idx_async_execution_events_due,priority:2"`
	ConsumeLeaseUntil *time.Time
	ConsumeAttempts   int32     `gorm:"not null"`
	StateVersion      int64     `gorm:"not null"`
	LastErrorCode     string    `gorm:"size:128;not null"`
	LastErrorMessage  string    `gorm:"type:text;not null"`
	CreatedAt         time.Time `gorm:"not null"`
	UpdatedAt         time.Time `gorm:"not null"`
	ConsumedAt        *time.Time
}

func (asyncExecutionEventRow) TableName() string { return "async_execution_events" }

func Models() []any {
	return []any{&taskRunRow{}, &pollScheduleRow{}, &asyncDispatchRow{}, &asyncExecutionEventRow{}}
}
