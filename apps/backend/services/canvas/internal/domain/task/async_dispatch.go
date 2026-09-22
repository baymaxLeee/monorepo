package task

import (
	"errors"
	"strings"
	"time"
)

var ErrInvalidAsyncDispatch = errors.New("async dispatch is invalid")

const (
	AsyncExecutionRecoveryWindow = 24 * time.Hour

	CanvasVideoArchiveExportTopic      = "canvas-canvas-video-archive-export"
	CanvasNodeVideoFirstLastFrameTopic = "canvas-canvas-node-video-first-last-frame"
)

func AsyncTopic(runType RunType) string {
	switch runType {
	case RunTypeCanvasVideoArchiveExport:
		return CanvasVideoArchiveExportTopic
	case RunTypeCanvasNodeVideoFirstLastFrameExtraction:
		return CanvasNodeVideoFirstLastFrameTopic
	default:
		return ""
	}
}

type AsyncDeliveryState string

const (
	AsyncDeliveryPending   AsyncDeliveryState = "PENDING"
	AsyncDeliveryDelivered AsyncDeliveryState = "DELIVERED"
)

func (state AsyncDeliveryState) Valid() bool {
	switch state {
	case AsyncDeliveryPending, AsyncDeliveryDelivered:
		return true
	default:
		return false
	}
}

type AsyncExecutionState string

const (
	AsyncExecutionWaiting        AsyncExecutionState = "WAITING"
	AsyncExecutionExecuting      AsyncExecutionState = "EXECUTING"
	AsyncExecutionFailurePending AsyncExecutionState = "FAILURE_PENDING"
)

func (state AsyncExecutionState) Valid() bool {
	switch state {
	case AsyncExecutionWaiting, AsyncExecutionExecuting, AsyncExecutionFailurePending:
		return true
	default:
		return false
	}
}

// AsyncDispatch contains independent delivery and execution state machines for
// one asynchronous TaskRun. Each state machine owns its own fencing version.
type AsyncDispatch struct {
	TaskRunID           string
	RunType             RunType
	DeliveryState       AsyncDeliveryState
	ExecutionState      AsyncExecutionState
	NextDispatchAt      time.Time
	PublishLeaseUntil   *time.Time
	ExecutionLeaseUntil *time.Time
	ExecutionToken      string
	DeliveryVersion     int64
	ExecutionVersion    int64
	PublishAttempts     int32
	ExecutionAttempts   int32
	ExecutionFailures   int32
	LeaseRecoveries     int32
	FirstStartedAt      *time.Time
	LastErrorCode       string
	LastErrorMessage    string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (dispatch AsyncDispatch) Validate() error {
	if strings.TrimSpace(dispatch.TaskRunID) == "" ||
		AsyncTopic(dispatch.RunType) == "" ||
		!dispatch.DeliveryState.Valid() ||
		!dispatch.ExecutionState.Valid() ||
		dispatch.NextDispatchAt.IsZero() ||
		dispatch.DeliveryVersion < 1 ||
		dispatch.ExecutionVersion < 1 ||
		dispatch.CreatedAt.IsZero() ||
		dispatch.UpdatedAt.IsZero() {
		return ErrInvalidAsyncDispatch
	}
	if dispatch.ExecutionState == AsyncExecutionExecuting && dispatch.ExecutionLeaseUntil == nil {
		return ErrInvalidAsyncDispatch
	}
	if dispatch.ExecutionState == AsyncExecutionExecuting && strings.TrimSpace(dispatch.ExecutionToken) == "" {
		return ErrInvalidAsyncDispatch
	}
	if dispatch.ExecutionState == AsyncExecutionWaiting &&
		(dispatch.ExecutionLeaseUntil != nil || strings.TrimSpace(dispatch.ExecutionToken) != "") {
		return ErrInvalidAsyncDispatch
	}
	return nil
}

func (dispatch AsyncDispatch) RecoveryExpired(now time.Time) bool {
	startedAt := dispatch.CreatedAt
	if dispatch.FirstStartedAt != nil {
		startedAt = *dispatch.FirstStartedAt
	}
	return !startedAt.IsZero() && !startedAt.After(now.Add(-AsyncExecutionRecoveryWindow))
}
