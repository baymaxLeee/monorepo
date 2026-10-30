package http

import (
	"context"
	canvasdto "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	dto "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	app "github.com/example/monorepo/canvas/internal/application/canvas"
	generation "github.com/example/monorepo/canvas/internal/application/canvasgeneration"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	video "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"time"
)

func (h *CanvasNodeHandler) SetStream(source stream.Source) { h.stream = source }
func (h *CanvasNodeHandler) CanvasCursor(ctx context.Context, workspace *string, project, canvas string) (int64, error) {
	return h.stream.Cursor(ctx, canvasnodeScope(ctx, workspace), project, canvas)
}
func (h *CanvasNodeHandler) SetCanvasMetadata(service *app.Service) { h.canvasMetadata = service }
func (h *CanvasNodeHandler) streamCanvasDTO(ctx context.Context, value domain.Canvas) *canvasdto.ProjectCanvasSummary {
	if h.canvasMetadata != nil {
		value = h.canvasMetadata.EnrichCoverImage(ctx, value)
	}
	return canvasSummary(value)
}
func taskDTO(t stream.TaskState) *dto.CanvasStreamTask {
	kind := dto.CanvasNodeTaskType_GENERATION
	if t.TaskType == "CANVAS_NODE_ASSETS_MATCH" {
		kind = dto.CanvasNodeTaskType_ASSETS_MATCH
	}
	value := &dto.CanvasStreamTask{NodeID: t.NodeID, TaskRunID: t.TaskRunID, Status: generationStatusDTO(t.Status), TaskType: kind, ErrorCode: t.ErrorCode, ErrorMessage: t.ErrorMessage, SeedanceTaskID: t.SeedanceTaskID}
	if t.ProviderStatus != "" {
		status := providerStatusDTO(video.ProviderStatus(t.ProviderStatus))
		value.VideoProviderStatus = &status
	}
	return value
}
func (h *CanvasNodeHandler) streamSnapshotDTO(ctx context.Context, scope app.Scope, state stream.State) (*dto.GetCanvasGraphResponse, error) {
	views, err := h.canvas_nodes.ProjectStreamViews(ctx, scope, state.Nodes)
	if err != nil {
		return nil, err
	}
	result := &dto.GetCanvasGraphResponse{Canvas: h.streamCanvasDTO(ctx, *state.Canvas), Archives: []*canvasdto.ProjectCanvasVideoArchiveExport{}, Cursor: state.Cursor, Nodes: []*dto.CanvasNode{}, Tasks: []*dto.CanvasStreamTask{}, Texts: []*dto.CanvasTextCheckpoint{}, ProtectedNodeIDs: state.ProtectedNodeIDs}
	for _, item := range state.Archives {
		result.Archives = append(result.Archives, archiveExportDTO(item, time.Now()))
	}
	for _, view := range views {
		// Delivery enrichment must not replace journal-frozen review facts.
		view.AssetsMatching = false
		view.Reviews = nil
		for _, review := range state.NodeReviews {
			if review.NodeID == view.ID {
				view.Reviews = review.Reviews
			}
		}
		node := canvasnodeViewDTO(view, state.NodeNumbers[view.ID], generation.GenerationFailure{})
		if draft, ok := state.Drafts[view.ID]; ok {
			node.DraftSession = draftSessionDTO(draft, true)
		}
		result.Nodes = append(result.Nodes, node)
	}
	for _, task := range state.Tasks {
		result.Tasks = append(result.Tasks, taskDTO(task))
	}
	for _, t := range state.Texts {
		result.Texts = append(result.Texts, &dto.CanvasTextCheckpoint{NodeID: t.NodeID, TaskRunID: t.TaskRunID, Content: t.Content, Status: t.Status, Offset: t.Offset})
	}
	return result, nil
}
func (h *CanvasNodeHandler) CanvasEvents(ctx context.Context, workspace *string, project, canvas string, cursor int64) ([]*dto.CanvasPatchEvent, error) {
	scope := canvasnodeScope(ctx, workspace)
	events, err := h.stream.Events(ctx, scope, project, canvas, cursor, 64)
	if err != nil {
		return nil, err
	}
	result := make([]*dto.CanvasPatchEvent, 0, len(events))
	for _, event := range events {
		value := &dto.CanvasPatchEvent{ProtocolVersion: event.ProtocolVersion, BaseCursor: event.BaseCursor, Cursor: event.Cursor, OccurredAt: event.RecordedAt.Format(time.RFC3339Nano), RequestID: event.RequestID, Action: event.Action, Operations: []*dto.CanvasPatchOperation{}}
		for _, p := range event.Patches {
			op := &dto.CanvasPatchOperation{Kind: string(p.Kind), Key: p.Key, NodeID: p.NodeID}
			if p.Canvas != nil {
				op.Canvas = h.streamCanvasDTO(ctx, *p.Canvas)
			}
			if p.Archive != nil {
				op.Archive = archiveExportDTO(*p.Archive, time.Now())
			}
			if p.Node != nil {
				views, e := h.canvas_nodes.ProjectStreamViews(ctx, scope, []domain.CanvasNode{*p.Node})
				if e != nil {
					return nil, e
				}
				views[0].Reviews = nil
				views[0].AssetsMatching = false
				op.Node = canvasnodeViewDTO(views[0], p.NodeNumber, generation.GenerationFailure{})
				if p.NodeDraft != nil {
					op.Node.DraftSession = draftSessionDTO(*p.NodeDraft, true)
				}
			}
			if p.Task != nil {
				op.Task = taskDTO(*p.Task)
			}
			if t := p.TextDelta; t != nil {
				op.TextDelta = &dto.CanvasTextDelta{NodeID: t.NodeID, TaskRunID: t.TaskRunID, Content: t.Content, StartOffset: t.StartOffset, EndOffset: t.EndOffset}
			}
			if t := p.TextStatus; t != nil {
				op.TextStatus = &dto.CanvasTextStatus{NodeID: t.NodeID, TaskRunID: t.TaskRunID, Status: t.Status, Offset: t.Offset}
			}
			if r := p.NodeReviews; r != nil {
				op.NodeReviews = &dto.CanvasNodeReviews{NodeID: r.NodeID, AssetID: r.AssetID, Reviews: assetReviewDTOs(r.Reviews)}
			}
			value.Operations = append(value.Operations, op)
		}
		result = append(result, value)
	}
	return result, nil
}
