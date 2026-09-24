package canvasarchive

import "time"

const (
	RunType        = "CANVAS_VIDEO_ARCHIVE_EXPORT"
	StateReady     = "READY"
	StateRetry     = "RETRY"
	StateSucceeded = "SUCCEEDED"
	StateTerminal  = "TERMINAL"
)

type GetExecutionResponse struct {
	State     string     `json:"State"`
	Execution *Execution `json:"Execution,omitempty"`
}

type Execution struct {
	TaskRunID, TenantID, CreatedBy, OutputFilename string
	SnapshotAt                                     time.Time
	Inputs                                         []Input
	Output                                         *Output `json:"Output,omitempty"`
}

type Input struct {
	SourceAssetID    string
	SourceRevisionID string
	EntryName        string
	Ordinal          int32
	MediaSize        int64
}

type Output struct {
	AssetID, RevisionID, SHA256, UploadID string
	Size, PartSize                        int64
	RetentionStartedAt                    time.Time
}
