package canvasnode

import (
	"github.com/example/monorepo/canvas/internal/api/contracts/asset"
	"github.com/example/monorepo/canvas/internal/api/contracts/canvas"
)

// Canvas stream contracts are independent from Chat UIMessage streams.
type CanvasStreamTask struct {
	NodeID              string                         `json:"NodeID"`
	TaskRunID           string                         `json:"TaskRunID"`
	Status              CanvasGenerationStatus         `json:"Status"`
	TaskType            CanvasNodeTaskType             `json:"TaskType"`
	ErrorCode           string                         `json:"ErrorCode"`
	ErrorMessage        string                         `json:"ErrorMessage"`
	VideoProviderStatus *CanvasNodeVideoProviderStatus `json:"VideoProviderStatus,omitempty"`
	SeedanceTaskID      string                         `json:"SeedanceTaskID"`
}
type CanvasTextCheckpoint struct {
	NodeID    string `json:"NodeID"`
	TaskRunID string `json:"TaskRunID"`
	Content   string `json:"Content"`
	Status    string `json:"Status"`
	Offset    int64  `json:"Offset"`
}
type CanvasTextDelta struct {
	NodeID      string `json:"NodeID"`
	TaskRunID   string `json:"TaskRunID"`
	Content     string `json:"Content"`
	StartOffset int64  `json:"StartOffset"`
	EndOffset   int64  `json:"EndOffset"`
}
type CanvasTextStatus struct {
	NodeID    string `json:"NodeID"`
	TaskRunID string `json:"TaskRunID"`
	Status    string `json:"Status"`
	Offset    int64  `json:"Offset"`
}
type CanvasNodeReviews struct {
	NodeID  string               `json:"NodeID"`
	AssetID string               `json:"AssetID"`
	Reviews []*asset.AssetReview `json:"Reviews"`
}
type CanvasPatchOperation struct {
	Canvas      *canvas.ProjectCanvasSummary            `json:"Canvas,omitempty"`
	Archive     *canvas.ProjectCanvasVideoArchiveExport `json:"Archive,omitempty"`
	Kind        string                                  `json:"Kind"`
	Key         string                                  `json:"Key"`
	NodeID      string                                  `json:"NodeID,omitempty"`
	Node        *CanvasNode                             `json:"Node,omitempty"`
	Task        *CanvasStreamTask                       `json:"Task,omitempty"`
	TextDelta   *CanvasTextDelta                        `json:"TextDelta,omitempty"`
	TextStatus  *CanvasTextStatus                       `json:"TextStatus,omitempty"`
	NodeReviews *CanvasNodeReviews                      `json:"NodeReviews,omitempty"`
}
type CanvasPatchEvent struct {
	ProtocolVersion int32                   `json:"ProtocolVersion"`
	BaseCursor      int64                   `json:"BaseCursor"`
	Cursor          int64                   `json:"Cursor"`
	OccurredAt      string                  `json:"OccurredAt"`
	RequestID       string                  `json:"RequestID"`
	Action          string                  `json:"Action"`
	Operations      []*CanvasPatchOperation `json:"Operations"`
}
