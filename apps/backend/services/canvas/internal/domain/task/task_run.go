package task

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidTaskRun        = errors.New("task run is invalid")
	ErrInvalidTaskTransition = errors.New("task run status transition is invalid")
)

type RunType string

const (
	RunTypeCanvasNodeVideoGeneration               RunType = "CANVAS_NODE_VIDEO_GENERATION"
	RunTypeCanvasVideoArchiveExport                RunType = "CANVAS_VIDEO_ARCHIVE_EXPORT"
	RunTypeCanvasNodeVideoFirstLastFrameExtraction RunType = "CANVAS_NODE_VIDEO_FIRST_LAST_FRAME_EXTRACTION"
	RunTypeCanvasStoryboardGeneration              RunType = "CANVAS_STORYBOARD_GENERATION"
	RunTypeImageGeneration                         RunType = "IMAGE_GENERATION"
	RunTypeCanvasNodeTextGeneration                RunType = "CANVAS_NODE_TEXT_GENERATION"
	RunTypeCanvasNodeAssetsMatch                   RunType = "CANVAS_NODE_ASSETS_MATCH"
	RunTypeAssetReview                             RunType = "ASSET_REVIEW"
)

type SubjectType string

const (
	SubjectTypeCanvasNode      SubjectType = "CANVAS_NODE"
	SubjectTypeCanvas          SubjectType = "CANVAS"
	SubjectTypeImageGeneration SubjectType = "IMAGE_GENERATION"
	SubjectTypeAsset           SubjectType = "ASSET"
)

type Status string

const (
	StatusQueued          = "queued"
	StatusRunning         = "running"
	StatusWaitingSubtasks = "waiting_subtasks"
	StatusSucceeded       = "succeeded"
	StatusPartialSuccess  = "partial_success"
	StatusFailed          = "failed"
	StatusCancelled       = "cancelled"
)

func (status Status) CanTransitionTo(next Status) bool {
	if !next.valid() {
		return false
	}
	switch status {
	case StatusQueued:
		return next == StatusQueued || next == StatusRunning ||
			next == StatusSucceeded || next == StatusFailed || next == StatusCancelled
	case StatusRunning:
		return next == StatusRunning || next == StatusWaitingSubtasks ||
			next == StatusSucceeded || next == StatusFailed || next == StatusCancelled
	case StatusWaitingSubtasks:
		return next == StatusWaitingSubtasks || next == StatusRunning ||
			next == StatusSucceeded || next == StatusPartialSuccess ||
			next == StatusFailed || next == StatusCancelled
	default:
		return false
	}
}

func (status Status) valid() bool {
	switch status {
	case StatusQueued, StatusRunning, StatusWaitingSubtasks, StatusSucceeded, StatusPartialSuccess, StatusFailed, StatusCancelled:
		return true
	default:
		return false
	}
}

type TaskRun struct {
	ID, TenantID, CreatedBy string
	WorkspaceID             *string
	RootTaskID              string
	ParentTaskID            *string
	RunType                 RunType
	SubjectType             SubjectType
	SubjectID               string
	Status                  Status
	IsInternal              bool
	HiddenAt                *time.Time
	ErrorCode, ErrorMessage string
	StateVersion            int64
	StartedAt, FinishedAt   *time.Time
	CreatedAt, UpdatedAt    time.Time
}

func (run TaskRun) Validate() error {
	if strings.TrimSpace(run.ID) == "" || strings.TrimSpace(run.TenantID) == "" ||
		strings.TrimSpace(run.CreatedBy) == "" ||
		strings.TrimSpace(run.SubjectID) == "" || run.StateVersion < 1 ||
		run.CreatedAt.IsZero() || run.UpdatedAt.IsZero() {
		return ErrInvalidTaskRun
	}
	if run.ParentTaskID == nil {
		if run.RootTaskID != "" && run.RootTaskID != run.ID {
			return ErrInvalidTaskRun
		}
	} else if strings.TrimSpace(*run.ParentTaskID) == "" || *run.ParentTaskID == run.ID ||
		strings.TrimSpace(run.RootTaskID) == "" || run.RootTaskID == run.ID {
		return ErrInvalidTaskRun
	}
	switch run.RunType {
	case RunTypeCanvasNodeVideoGeneration, RunTypeCanvasNodeTextGeneration, RunTypeCanvasNodeAssetsMatch, RunTypeCanvasStoryboardGeneration:
		if run.SubjectType != SubjectTypeCanvasNode {
			return ErrInvalidTaskRun
		}
	case RunTypeCanvasNodeVideoFirstLastFrameExtraction:
		if run.SubjectType != SubjectTypeCanvasNode || !run.IsInternal {
			return ErrInvalidTaskRun
		}
	case RunTypeCanvasVideoArchiveExport:
		if run.SubjectType != SubjectTypeCanvas {
			return ErrInvalidTaskRun
		}
	case RunTypeImageGeneration:
		if run.SubjectType != SubjectTypeImageGeneration {
			return ErrInvalidTaskRun
		}
	case RunTypeAssetReview:
		if run.SubjectType != SubjectTypeAsset {
			return ErrInvalidTaskRun
		}
	default:
		return ErrInvalidTaskRun
	}
	if !run.Status.valid() {
		return ErrInvalidTaskRun
	}
	return nil
}

func (run TaskRun) Terminal() bool {
	switch run.Status {
	case StatusSucceeded, StatusPartialSuccess, StatusFailed, StatusCancelled:
		return true
	default:
		return false
	}
}

func (run TaskRun) EffectiveRootTaskID() string {
	if run.RootTaskID != "" {
		return run.RootTaskID
	}
	return run.ID
}
