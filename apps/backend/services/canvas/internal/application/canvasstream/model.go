package canvasstream

import (
	"context"
	"errors"
	"time"

	canvas "github.com/example/monorepo/canvas/internal/application/canvas"
	archive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
)

var ErrCursorExpired = errors.New("canvas event cursor expired")

const PatchProtocolVersion int32 = 3

type PatchKind string

const (
	PatchCanvasUpsert      PatchKind = "canvas.upsert"
	PatchArchiveUpsert     PatchKind = "archive.upsert"
	PatchArchiveRemove     PatchKind = "archive.remove"
	PatchNodeReviewsUpsert PatchKind = "node_reviews.upsert"
	PatchNodeReviewsRemove PatchKind = "node_reviews.remove"
	PatchNodeUpsert        PatchKind = "node.upsert"
	PatchNodeRemove        PatchKind = "node.remove"
	PatchTaskUpsert        PatchKind = "task.upsert"
	PatchTaskRemove        PatchKind = "task.remove"
	PatchTextAppend        PatchKind = "text.append"
	PatchTextStatus        PatchKind = "text.status"
	PatchProtectionAdd     PatchKind = "protection.add"
	PatchProtectionRemove  PatchKind = "protection.remove"
)

type TaskState struct{ NodeID, TaskRunID, Status, ErrorCode, ErrorMessage, TaskType, ProviderStatus, SeedanceTaskID string }
type TextCheckpoint struct {
	NodeID, TaskRunID, Content, Status string
	Offset                             int64
}
type TextDelta struct {
	NodeID, TaskRunID, Content string
	StartOffset, EndOffset     int64
}
type TextStatus struct {
	NodeID, TaskRunID, Status string
	Offset                    int64
}
type NodeReviews struct {
	NodeID  string
	AssetID string
	Reviews []domainasset.Review
}

type Patch struct {
	Canvas          *domain.Canvas
	Archive         *archive.Export
	NodeDraft       *canvas.StoryboardSession
	NodeReviews     *NodeReviews
	Kind            PatchKind
	Key             string
	NodeID          string
	NodeNumber      int32
	VisibilityOwner string
	Node            *domain.CanvasNode
	Task            *TaskState
	TextDelta       *TextDelta
	TextStatus      *TextStatus
}
type State struct {
	Canvas            *domain.Canvas
	Archives          []archive.Export
	Drafts            map[string]canvas.StoryboardSession
	NodeReviews       []NodeReviews
	PrivateNodeOwners map[string]string
	Cursor            int64
	Nodes             []domain.CanvasNode
	// NodeNumbers carries derived storyboard numbering so inserts can publish
	// unchanged nodes whose visible number shifted. ADR-0077.
	NodeNumbers      map[string]int32
	Tasks            []TaskState
	Texts            []TextCheckpoint
	ProtectedNodeIDs []string
}
type Event struct {
	ProtocolVersion int32
	BaseCursor      int64
	Cursor          int64
	RecordedAt      time.Time
	RequestID       string
	Action          string
	Patches         []Patch
}
type Source interface {
	Snapshot(context.Context, canvas.Scope, string, string) (State, error)
	Events(context.Context, canvas.Scope, string, string, int64, int) ([]Event, error)
	Cursor(context.Context, canvas.Scope, string, string) (int64, error)
}
