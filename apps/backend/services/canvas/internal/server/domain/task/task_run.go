package task

import (
	"errors"
	"strings"
	"time"
)

var ErrInvalidTaskRun = errors.New("task run is invalid")

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
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

type TaskRun struct {
	ID, TenantID, CreatedBy string
	WorkspaceID             *string
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
	switch run.RunType {
	case RunTypeCanvasNodeVideoGeneration, RunTypeCanvasNodeTextGeneration, RunTypeCanvasNodeAssetsMatch:
		if run.SubjectType != SubjectTypeCanvasNode {
			return ErrInvalidTaskRun
		}
	case RunTypeCanvasNodeVideoFirstLastFrameExtraction:
		if run.SubjectType != SubjectTypeCanvasNode || !run.IsInternal {
			return ErrInvalidTaskRun
		}
	case RunTypeCanvasVideoArchiveExport, RunTypeCanvasStoryboardGeneration:
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
	switch run.Status {
	case StatusQueued, StatusRunning, StatusSucceeded, StatusFailed, StatusCancelled:
	default:
		return ErrInvalidTaskRun
	}
	return nil
}

func (run TaskRun) Terminal() bool {
	switch run.Status {
	case StatusSucceeded, StatusFailed, StatusCancelled:
		return true
	default:
		return false
	}
}
