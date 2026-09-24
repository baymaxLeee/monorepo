package canvasarchive

import (
	"errors"
	"time"

	"github.com/example/monorepo/canvas/internal/domain/task"
)

var (
	ErrNotFound                 = errors.New("canvas video archive export not found")
	ErrNoSelectedVideos         = errors.New("canvas has no selected videos")
	ErrSelectedVideoUnavailable = errors.New("selected canvas video is unavailable")
	ErrActiveExportExists       = errors.New("canvas video archive export is already active")
	ErrExecutionNotReady        = errors.New("canvas video archive export execution is not ready")
	ErrExecutionTerminal        = errors.New("canvas video archive export is terminal")
)

type CleanupStatus string

const (
	CleanupStatusWaiting   CleanupStatus = "waiting"
	CleanupStatusPending   CleanupStatus = "pending"
	CleanupStatusCompleted CleanupStatus = "completed"
)

type Scope struct {
	TenantID    string
	CallerID    string
	WorkspaceID *string
}

type SortDirection int

const (
	SortUnspecified SortDirection = iota
	SortAscending
	SortDescending
)

type Page struct {
	PageSize int
	PageNum  int
}

type ListQuery struct {
	Scope
	ProjectID, CanvasID string
	SortDirection       SortDirection
	PageSize, PageNum   int
}

type SelectedVideo struct {
	CanvasName, NodeID, OutputID, AssetID, SourceAssetID, SourceRevisionID string
	MediaSize                                                              int64
}

type Export struct {
	TaskRunID, TenantID, ProjectID, CanvasID, CreatedBy           string
	WorkspaceID                                                   *string
	Status                                                        task.Status
	ErrorCode, ErrorMessage                                       string
	InputCount                                                    int32
	OutputFilename, OutputAssetID, OutputRevisionID, OutputSHA256 string
	OutputSize, PartSize                                          int64
	UploadID                                                      string
	RetentionStartedAt, RetentionGuaranteedUntil                  *time.Time
	CleanupStatus                                                 CleanupStatus
	CleanupNextAt, CleanupLeaseUntil                              *time.Time
	CleanupStateVersion                                           int64
	CleanupAttempts                                               int32
	CleanupLastError                                              string
	StartedAt, FinishedAt                                         *time.Time
	CreatedAt, UpdatedAt                                          time.Time
}

func (item Export) DownloadPath(now time.Time) *string {
	if item.Status != task.StatusSucceeded || item.OutputAssetID == "" || item.OutputRevisionID == "" || item.RetentionGuaranteedUntil == nil || !now.Before(*item.RetentionGuaranteedUntil) {
		return nil
	}
	revisionID := item.OutputRevisionID
	return &revisionID
}

type Input struct {
	TaskRunID, NodeID, OutputID, AssetID, SourceAssetID, SourceRevisionID, EntryName string
	Ordinal                                                                          int32
	MediaSize                                                                        int64
	CreatedAt                                                                        time.Time
}

type LifecycleUpdate struct {
	Status                  task.Status
	ErrorCode, ErrorMessage string
	StartedAt, FinishedAt   *time.Time
}

type Execution struct {
	Export Export
	Inputs []Input
}

type SuccessResult struct {
	AssetID, RevisionID, SHA256 string
	UploadID                    string
	Size, PartSize              int64
	RetentionStartedAt          time.Time
}
