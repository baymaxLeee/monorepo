package http

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/http/topcontext"
	applicationcanvasnode "github.com/example/monorepo/canvas/internal/server/application/canvas"
	applicationcanvasgeneration "github.com/example/monorepo/canvas/internal/server/application/canvasgeneration"
	applicationcanvastextgeneration "github.com/example/monorepo/canvas/internal/server/application/canvastextgeneration"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/server/application/videogeneration"
	contractasset "github.com/example/monorepo/canvas/internal/server/contracts/asset"
	contractbase "github.com/example/monorepo/canvas/internal/server/contracts/base"
	contractcanvasnode "github.com/example/monorepo/canvas/internal/server/contracts/canvasnode"
	contractresource "github.com/example/monorepo/canvas/internal/server/contracts/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domaincanvasnode "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/server/domain/generationinput"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/server/domain/videogeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

// CanvasNodeHandler owns the storyboard RPC surface and keeps Canvas
// aggregate CRUD free from storyboard-only dependencies.
type canvasnodeService interface {
	CancelAssetsMatch(context.Context, applicationcanvasnode.Scope, string, string, string, string) error
	StartAssetsMatch(context.Context, applicationcanvasnode.StartAssetsMatchInput) (domaintask.TaskRun, error)
	BatchGetViews(context.Context, applicationcanvasnode.Scope, string, string, []string) ([]applicationcanvasnode.CanvasNodeView, error)
	ListGraph(context.Context, applicationcanvasnode.Scope, string, string) ([]applicationcanvasnode.CanvasNodeView, error)
	ProjectViews(context.Context, applicationcanvasnode.Scope, []domaincanvasnode.CanvasNode) ([]applicationcanvasnode.CanvasNodeView, error)
	Create(context.Context, applicationcanvasnode.Scope, applicationcanvasnode.CreateNodeInput) (domaincanvasnode.CanvasNode, int32, int64, error)
	Copy(context.Context, applicationcanvasnode.Scope, applicationcanvasnode.CopyNodeInput) (applicationcanvasnode.CopyNodeResult, error)
	ConfirmStoryboardDrafts(context.Context, applicationcanvasnode.Scope, string, string, []applicationcanvasnode.CanvasNodeDraftConfirmInput) ([]domaincanvasnode.CanvasNode, int64, error)
	Update(context.Context, applicationcanvasnode.Scope, string, string, string, applicationcanvasnode.UpdatePatch) (applicationcanvasnode.UpdateResult, error)
	BatchUpdatePositions(context.Context, applicationcanvasnode.Scope, string, string, []applicationcanvasnode.CanvasNodePositionUpdate) (applicationcanvasnode.BatchUpdatePositionsResult, error)
	Delete(context.Context, applicationcanvasnode.Scope, string, string, string) error
}

type canvasnodeGraphService interface {
	ConnectNodes(context.Context, applicationcanvasnode.ConnectNodesInput) (applicationcanvasnode.ConnectNodesResult, error)
	MaterializeResourceAssetReference(context.Context, applicationcanvasnode.MaterializeResourceAssetReferenceInput) (applicationcanvasnode.MaterializeResourceAssetReferenceResult, error)
	MaterializeStandaloneAssetReference(context.Context, applicationcanvasnode.MaterializeStandaloneAssetReferenceInput) (applicationcanvasnode.MaterializeStandaloneAssetReferenceResult, error)
	DeleteNode(context.Context, applicationcanvasnode.DeleteNodeInput) (int64, error)
	BatchDeleteNodes(context.Context, applicationcanvasnode.BatchDeleteNodesInput) (int64, error)
	DeleteEdge(context.Context, applicationcanvasnode.DeleteEdgeInput) (applicationcanvasnode.DeleteEdgeResult, error)
	ReorderStoryboard(context.Context, applicationcanvasnode.ReorderStoryboardInput) (applicationcanvasnode.ReorderStoryboardResult, error)
}

type canvasTextGenerationService interface {
	Start(context.Context, applicationcanvasnode.Scope, string, string, string) (applicationcanvastextgeneration.Session, error)
	Cancel(context.Context, applicationcanvasnode.Scope, string, string, string, string) error
	Get(context.Context, applicationcanvasnode.Scope, string, string, string, string) (applicationcanvastextgeneration.Session, error)
	ReadDeltas(context.Context, applicationcanvasnode.Scope, string, string, string, string, string, time.Duration) ([]applicationcanvastextgeneration.Delta, error)
}

func (h *CanvasNodeHandler) MaterializeCanvasStandaloneAssetReference(ctx context.Context, r *contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceRequest) (*contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceResponse, error) {
	if err := requireAction(ctx, "MaterializeCanvasStandaloneAssetReference"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	targetPort, ok := portFromDTO(r.TargetPort)
	if !ok || h.graph == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	referenceType, ok := mentionReferenceTypeFromDTO(r.ReferenceType)
	if !ok {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if r.AssetNodePosition == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	position := &domaincanvasnode.Position{PositionX: r.AssetNodePosition.PositionX, PositionY: r.AssetNodePosition.PositionY}
	result, err := h.graph.MaterializeStandaloneAssetReference(ctx, applicationcanvasnode.MaterializeStandaloneAssetReferenceInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		TargetNodeID: r.TargetNodeID, AssetID: r.GetAssetID(), ReferenceType: referenceType,
		TargetPort: targetPort, AssetNodePosition: position, UploadedAsset: uploadedAssetInput(r.UploadedAsset),
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{result.AssetNode, result.TargetNode})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceResponse{AssetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), TargetNode: canvasnodeViewDTO(views[1], 0, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision, CreatedAssetNode: result.CreatedAssetNode}, nil
}

func (h *CanvasNodeHandler) MaterializeCanvasResourceAssetReference(
	ctx context.Context,
	r *contractcanvasnode.MaterializeCanvasResourceAssetReferenceRequest,
) (*contractcanvasnode.MaterializeCanvasResourceAssetReferenceResponse, error) {
	if err := requireAction(ctx, "MaterializeCanvasResourceAssetReference"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	targetPort, ok := portFromDTO(r.TargetPort)
	if !ok || h.graph == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	referenceType, ok := mentionReferenceTypeFromDTO(r.ReferenceType)
	if !ok {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if r.ResourceAssetNodePosition == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	position := &domaincanvasnode.Position{PositionX: r.ResourceAssetNodePosition.PositionX, PositionY: r.ResourceAssetNodePosition.PositionY}
	result, err := h.graph.MaterializeResourceAssetReference(ctx, applicationcanvasnode.MaterializeResourceAssetReferenceInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		TargetNodeID: r.TargetNodeID, ReferenceType: referenceType,
		ResourceID: r.GetResourceID(), ResourceAssetID: r.GetResourceAssetID(), TargetPort: targetPort,
		ResourceAssetNodePosition: position,
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{result.ResourceAssetNode, result.TargetNode})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.MaterializeCanvasResourceAssetReferenceResponse{
		ResourceAssetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), TargetNode: canvasnodeViewDTO(views[1], 0, applicationcanvasgeneration.GenerationFailure{}),
		CanvasRevision:           result.CanvasRevision,
		CreatedResourceAssetNode: result.CreatedResourceAssetNode,
	}, nil
}

type canvasnodeAssetService interface {
	CreateCanvasAsset(context.Context, applicationcanvasnode.CreateCanvasAssetInput) (domainasset.Asset, error)
	Search(context.Context, applicationcanvasnode.Scope, string, string, string, string, string, int, []domaincanvasnode.MediaType) (applicationcanvasnode.CanvasNodeAvailableAssetSearch, error)
}

func (h *CanvasNodeHandler) CreateCanvasAsset(
	ctx context.Context,
	r *contractcanvasnode.CreateCanvasAssetRequest,
) (*contractcanvasnode.CreateCanvasAssetResponse, error) {
	if err := requireAction(ctx, "CreateCanvasAsset"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	item, err := h.assets.CreateCanvasAsset(ctx, applicationcanvasnode.CreateCanvasAssetInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		BlobID: r.BlobID, FileName: r.FileName,
	})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.CreateCanvasAssetResponse{Asset: assetDTO(item)}, nil
}

type generationService interface {
	Start(context.Context, applicationcanvasnode.Scope, string, string, string) (string, error)
	BatchGetStates(context.Context, applicationcanvasnode.Scope, string, string, []applicationcanvasgeneration.GenerationTarget) ([]applicationcanvasgeneration.GenerationState, error)
	BatchGetLatestFailures(context.Context, applicationcanvasnode.Scope, []domaincanvasnode.CanvasNode) (map[string]applicationcanvasgeneration.GenerationFailure, error)
	StartCanvas(context.Context, applicationcanvasnode.Scope, string, string) ([]applicationvideogeneration.CanvasStart, int, error)
	List(context.Context, applicationcanvasnode.Scope, string, string, string) ([]applicationvideogeneration.TaskRun, error)
	Select(context.Context, applicationcanvasnode.Scope, string, string, string, string) (applicationvideogeneration.TaskRun, error)
	Cancel(context.Context, applicationcanvasnode.Scope, string, string, string, string) error
}

type storyboardDraftService interface {
	Start(context.Context, applicationcanvasnode.Scope, string, string, string, applicationcanvasnode.StoryboardModelConfig, applicationcanvasnode.StoryboardPlanningConfig, int) (applicationcanvasnode.StoryboardSession, error)
	Get(context.Context, applicationcanvasnode.Scope, string, string, string) (applicationcanvasnode.StoryboardSession, error)
	List(context.Context, applicationcanvasnode.Scope, string, string) ([]applicationcanvasnode.StoryboardSession, error)
	Cancel(context.Context, applicationcanvasnode.Scope, string, string, string) error
	Confirm(context.Context, applicationcanvasnode.Scope, string, string, string, []applicationcanvasnode.StoryboardOverride) ([]domaincanvasnode.CanvasNode, int64, error)
}

func (h *CanvasNodeHandler) CreateCanvasNodes(ctx context.Context, r *contractcanvasnode.CreateCanvasNodesRequest) (*contractcanvasnode.CreateCanvasNodesResponse, error) {
	if err := requireAction(ctx, "CreateCanvasNodes"); err != nil {
		return nil, err
	}
	return nil, errno.New(errno.ErrInvalidArgument)
}

func (h *CanvasNodeHandler) GetCanvasNodeDrafts(ctx context.Context, r *contractcanvasnode.GetCanvasNodeDraftsRequest) (*contractcanvasnode.CreateCanvasNodesResponse, error) {
	if err := requireAction(ctx, "GetCanvasNodeDrafts"); err != nil {
		return nil, err
	}
	return nil, errno.New(errno.ErrInvalidArgument)
}

func (h *CanvasNodeHandler) ConfirmCanvasNodeDrafts(ctx context.Context, r *contractcanvasnode.ConfirmCanvasNodeDraftsRequest) (*contractcanvasnode.ConfirmCanvasNodeDraftsResponse, error) {
	if err := requireAction(ctx, "ConfirmCanvasNodeDrafts"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	overrides := make([]applicationcanvasnode.StoryboardOverride, 0, len(r.Items))
	for _, item := range r.Items {
		if item == nil || item.GenerationConfig == nil {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		overrides = append(overrides, applicationcanvasnode.StoryboardOverride{
			DraftID: item.DraftID, GenerationConfig: generationConfigFromDTO(item.GenerationConfig),
		})
	}
	items, canvasRevision, err := h.drafts.Confirm(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.TaskRunID, overrides)
	if err != nil {
		return nil, err
	}
	canvasNodeIDs := make([]string, 0, len(items))
	for _, item := range items {
		canvasNodeIDs = append(canvasNodeIDs, item.ID)
	}
	return &contractcanvasnode.ConfirmCanvasNodeDraftsResponse{CanvasNodeIDs: canvasNodeIDs, CanvasRevision: canvasRevision}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeDrafts(ctx context.Context, r *contractcanvasnode.CancelCanvasNodeDraftsRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeDrafts"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if err := h.drafts.Cancel(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *CanvasNodeHandler) StartCanvasNodeGeneration(ctx context.Context, r *contractcanvasnode.StartCanvasNodeGenerationRequest) (*contractcanvasnode.StartCanvasNodeGenerationResponse, error) {
	if err := requireAction(ctx, "StartCanvasNodeGeneration"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	taskRunID, err := h.generations.Start(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID)
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.StartCanvasNodeGenerationResponse{TaskRunID: taskRunID}, nil
}

func (h *CanvasNodeHandler) StartCanvasGeneration(ctx context.Context, r *contractcanvasnode.StartCanvasGenerationRequest) (*contractcanvasnode.StartCanvasGenerationResponse, error) {
	if err := requireAction(ctx, "StartCanvasGeneration"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	started, skipped, err := h.generations.StartCanvas(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID)
	if err != nil {
		return nil, err
	}
	items := make([]*contractcanvasnode.CanvasNodeGenerationStart, 0, len(started))
	for _, item := range started {
		items = append(items, &contractcanvasnode.CanvasNodeGenerationStart{NodeID: item.NodeID, TaskRunID: item.TaskRunID})
	}
	return &contractcanvasnode.StartCanvasGenerationResponse{Items: items, SkippedCount: int32(skipped)}, nil
}

func (h *CanvasNodeHandler) ListCanvasNodeHistories(ctx context.Context, r *contractcanvasnode.ListCanvasNodeHistoriesRequest) (*contractcanvasnode.ListCanvasNodeHistoriesResponse, error) {
	if err := requireAction(ctx, "ListCanvasNodeHistories"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	items, err := h.generations.List(
		ctx,
		canvasnodeScope(ctx, r.WorkspaceID),
		r.ProjectID,
		r.CanvasID,
		r.NodeID,
	)
	if err != nil {
		return nil, err
	}
	out := make([]*contractcanvasnode.CanvasNodeHistory, 0, len(items))
	for index := range items {
		out = append(out, historyDTO(items[index]))
	}
	return &contractcanvasnode.ListCanvasNodeHistoriesResponse{Items: out}, nil
}

func (h *CanvasNodeHandler) SelectCanvasNodeHistory(ctx context.Context, r *contractcanvasnode.SelectCanvasNodeHistoryRequest) (*contractcanvasnode.SelectCanvasNodeHistoryResponse, error) {
	if err := requireAction(ctx, "SelectCanvasNodeHistory"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	history, err := h.generations.Select(
		ctx,
		canvasnodeScope(ctx, r.WorkspaceID),
		r.ProjectID,
		r.CanvasID,
		r.NodeID,
		r.HistoryID,
	)
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.SelectCanvasNodeHistoryResponse{
		History: historyDTO(history),
	}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeGeneration(ctx context.Context, r *contractcanvasnode.CancelCanvasNodeGenerationRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeGeneration"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if err := h.generations.Cancel(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

type CanvasNodeHandler struct {
	canvas_nodes    canvasnodeService
	graph           canvasnodeGraphService
	assets          canvasnodeAssetService
	generations     generationService
	drafts          storyboardDraftService
	textGenerations canvasTextGenerationService
}

func NewCanvasNodeHandler(
	canvas_nodes *applicationcanvasnode.CanvasNodeService,
	assets *applicationcanvasnode.CanvasNodeAssetService,
	generations *applicationcanvasgeneration.Service,
	drafts *applicationcanvasnode.StoryboardService,
	textGenerations *applicationcanvastextgeneration.Service,
) *CanvasNodeHandler {
	return &CanvasNodeHandler{
		canvas_nodes: canvas_nodes, graph: canvas_nodes, assets: assets, generations: generations, drafts: drafts, textGenerations: textGenerations,
	}
}

func (h *CanvasNodeHandler) StartCanvasNodeTextGeneration(ctx context.Context, r *contractcanvasnode.StartCanvasNodeTextGenerationRequest) (*contractcanvasnode.CanvasNodeTextGenerationResponse, error) {
	if err := requireAction(ctx, "StartCanvasNodeTextGeneration"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	state, err := h.textGenerations.Start(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID)
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.CanvasNodeTextGenerationResponse{Session: textGenerationSessionDTO(state)}, nil
}
func (h *CanvasNodeHandler) CancelCanvasNodeTextGeneration(ctx context.Context, r *contractcanvasnode.CancelCanvasNodeTextGenerationRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeTextGeneration"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if err := h.textGenerations.Cancel(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func textGenerationSessionDTO(state applicationcanvastextgeneration.Session) *contractcanvasnode.CanvasTextGenerationSession {
	status := contractcanvasnode.CanvasGenerationStatus_QUEUED
	switch state.Status {
	case "running":
		status = contractcanvasnode.CanvasGenerationStatus_RUNNING
	case "succeeded":
		status = contractcanvasnode.CanvasGenerationStatus_SUCCEEDED
	case "failed":
		status = contractcanvasnode.CanvasGenerationStatus_FAILED
	case "cancelled":
		status = contractcanvasnode.CanvasGenerationStatus_CANCELLED
	}
	dto := &contractcanvasnode.CanvasTextGenerationSession{TaskRunID: state.ID, NodeID: state.NodeID, Status: status, Content: state.Content}
	if state.Failure != nil {
		dto.ErrorCode = optionalCanvasNodeString(state.Failure.Code)
		dto.ErrorMessage = optionalCanvasNodeString(state.Failure.Message)
	}
	return dto
}

func (h *CanvasNodeHandler) ListCanvasNodeDraftSessions(ctx context.Context, r *contractcanvasnode.ListCanvasNodeDraftSessionsRequest) (*contractcanvasnode.ListCanvasNodeDraftSessionsResponse, error) {
	if err := requireAction(ctx, "ListCanvasNodeDraftSessions"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	drafts, err := h.drafts.List(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID)
	if err != nil {
		return nil, err
	}
	items := make([]*contractcanvasnode.CanvasNodeDraftSession, 0, len(drafts))
	for _, draft := range drafts {
		items = append(items, draftSessionDTO(draft, false))
	}
	return &contractcanvasnode.ListCanvasNodeDraftSessionsResponse{Items: items}, nil
}

func (h *CanvasNodeHandler) GetCanvasGraph(
	ctx context.Context,
	r *contractcanvasnode.GetCanvasGraphRequest,
) (*contractcanvasnode.GetCanvasGraphResponse, error) {
	if err := requireAction(ctx, "GetCanvasGraph"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	items, err := h.canvas_nodes.ListGraph(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID)
	if err != nil {
		return nil, err
	}
	graphNodes := make([]domaincanvasnode.CanvasNode, 0, len(items))
	for _, item := range items {
		graphNodes = append(graphNodes, item.CanvasNode)
	}
	failures, err := h.generations.BatchGetLatestFailures(ctx, canvasnodeScope(ctx, r.WorkspaceID), graphNodes)
	if err != nil {
		return nil, err
	}
	nodes := make([]*contractcanvasnode.CanvasNode, 0, len(items))
	videoNo := int32(0)
	for _, item := range items {
		no := int32(0)
		if item.Type == domaincanvasnode.NodeTypeVideoGeneration {
			videoNo++
			no = videoNo
		}
		nodes = append(nodes, canvasnodeViewDTO(item, no, failures[item.ID]))
	}
	return &contractcanvasnode.GetCanvasGraphResponse{Nodes: nodes}, nil
}

func (h *CanvasNodeHandler) CreateCanvasNode(ctx context.Context, r *contractcanvasnode.CreateCanvasNodeRequest) (*contractcanvasnode.CreateCanvasNodeResponse, error) {
	if err := requireAction(ctx, "CreateCanvasNode"); err != nil {
		return nil, err
	}
	if r.Position == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	r.Top = topParam(ctx)
	item, canvasnodeNo, canvasRevision, err := h.canvas_nodes.Create(ctx, canvasnodeScope(ctx, r.WorkspaceID), applicationcanvasnode.CreateNodeInput{
		ProjectID: r.ProjectID, CanvasID: r.CanvasID, AfterNodeID: r.GetAfterNodeID(),
		Type:     domaincanvasnode.NodeType(r.Type),
		Position: domaincanvasnode.Position{PositionX: r.Position.PositionX, PositionY: r.Position.PositionY},
		Text:     r.GetText(), AssetID: r.GetAssetID(), ResourceID: r.GetResourceID(), ResourceAssetID: r.GetResourceAssetID(),
		ModelServiceID: r.GetModelServiceID(), UploadedAsset: uploadedAssetInput(r.UploadedAsset),
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{item})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.CreateCanvasNodeResponse{CanvasNode: canvasnodeViewDTO(views[0], canvasnodeNo, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: canvasRevision}, nil
}

func uploadedAssetInput(value *contractcanvasnode.CanvasUploadedAsset) *applicationcanvasnode.UploadedAssetInput {
	if value == nil {
		return nil
	}
	return &applicationcanvasnode.UploadedAssetInput{BlobID: value.BlobID, FileName: value.FileName}
}

func (h *CanvasNodeHandler) CopyCanvasNode(ctx context.Context, r *contractcanvasnode.CopyCanvasNodeRequest) (*contractcanvasnode.CopyCanvasNodeResponse, error) {
	if err := requireAction(ctx, "CopyCanvasNode"); err != nil {
		return nil, err
	}
	if r.Position == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	r.Top = topParam(ctx)
	result, err := h.canvas_nodes.Copy(ctx, canvasnodeScope(ctx, r.WorkspaceID), applicationcanvasnode.CopyNodeInput{
		ProjectID: r.ProjectID, CanvasID: r.CanvasID, SourceNodeID: r.SourceNodeID,
		Position: domaincanvasnode.Position{PositionX: r.Position.PositionX, PositionY: r.Position.PositionY},
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{result.CanvasNode})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.CopyCanvasNodeResponse{
		CanvasNode: canvasnodeViewDTO(views[0], result.CanvasNodeNo, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision,
	}, nil
}
func (h *CanvasNodeHandler) UpdateCanvasNode(ctx context.Context, r *contractcanvasnode.UpdateCanvasNodeRequest) (*contractcanvasnode.UpdateCanvasNodeResponse, error) {
	if err := requireAction(ctx, "UpdateCanvasNode"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	patch := applicationcanvasnode.UpdatePatch{Content: domaincanvasnode.UpdatePatch{
		Prompt: r.Prompt, Name: r.Name, Text: r.Text,
	}}
	if r.Position != nil {
		patch.Content.Position = &domaincanvasnode.Position{PositionX: r.Position.PositionX, PositionY: r.Position.PositionY}
	}
	if r.VideoInputMode != nil {
		mode := domaincanvasnode.VideoInputMode(*r.VideoInputMode)
		patch.Content.VideoInputMode = &mode
	}
	if r.GenerationConfig != nil {
		patch.Content.GenerationConfig = configPatchFromDTO(r.GenerationConfig)
	}
	result, err := h.canvas_nodes.Update(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, patch)
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{result.CanvasNode})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.UpdateCanvasNodeResponse{CanvasNode: canvasnodeViewDTO(views[0], result.CanvasNodeNo, applicationcanvasgeneration.GenerationFailure{})}, nil
}

func (h *CanvasNodeHandler) BatchUpdateCanvasNodePositions(ctx context.Context, r *contractcanvasnode.BatchUpdateCanvasNodePositionsRequest) (*contractcanvasnode.BatchUpdateCanvasNodePositionsResponse, error) {
	if err := requireAction(ctx, "BatchUpdateCanvasNodePositions"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	updates := make([]applicationcanvasnode.CanvasNodePositionUpdate, 0, len(r.Items))
	for _, item := range r.Items {
		if item == nil || item.Position == nil {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		updates = append(updates, applicationcanvasnode.CanvasNodePositionUpdate{
			NodeID: item.NodeID, Position: domaincanvasnode.Position{PositionX: item.Position.PositionX, PositionY: item.Position.PositionY},
		})
	}
	result, err := h.canvas_nodes.BatchUpdatePositions(
		ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, updates,
	)
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), result.Items)
	if err != nil {
		return nil, err
	}
	items := make([]*contractcanvasnode.CanvasNode, 0, len(views))
	for _, view := range views {
		items = append(items, canvasnodeViewDTO(view, 0, applicationcanvasgeneration.GenerationFailure{}))
	}
	return &contractcanvasnode.BatchUpdateCanvasNodePositionsResponse{Items: items}, nil
}
func (h *CanvasNodeHandler) DeleteCanvasNode(ctx context.Context, r *contractcanvasnode.DeleteCanvasNodeRequest) (*contractcanvasnode.DeleteCanvasNodeResponse, error) {
	if err := requireAction(ctx, "DeleteCanvasNode"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if h.graph == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	revision, err := h.graph.DeleteNode(ctx, applicationcanvasnode.DeleteNodeInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		NodeID: r.NodeID,
	})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.DeleteCanvasNodeResponse{CanvasRevision: revision}, nil
}

func (h *CanvasNodeHandler) BatchDeleteCanvasNodes(ctx context.Context, r *contractcanvasnode.BatchDeleteCanvasNodesRequest) (*contractcanvasnode.BatchDeleteCanvasNodesResponse, error) {
	if err := requireAction(ctx, "BatchDeleteCanvasNodes"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if h.graph == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	revision, err := h.graph.BatchDeleteNodes(ctx, applicationcanvasnode.BatchDeleteNodesInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID, NodeIDs: r.NodeIDs,
	})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.BatchDeleteCanvasNodesResponse{CanvasRevision: revision}, nil
}

func (h *CanvasNodeHandler) ConnectCanvasNodes(
	ctx context.Context,
	r *contractcanvasnode.ConnectCanvasNodesRequest,
) (*contractcanvasnode.ConnectCanvasNodesResponse, error) {
	if err := requireAction(ctx, "ConnectCanvasNodes"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	targetPort, ok := portFromDTO(r.TargetPort)
	if !ok {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	if h.graph == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	result, err := h.graph.ConnectNodes(ctx, applicationcanvasnode.ConnectNodesInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		SourceNodeID: r.SourceNodeID, TargetNodeID: r.TargetNodeID, TargetPort: targetPort,
		TargetOrder: r.TargetOrder,
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{result.TargetNode})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.ConnectCanvasNodesResponse{
		TargetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision,
	}, nil
}

func (h *CanvasNodeHandler) DeleteCanvasEdge(
	ctx context.Context,
	r *contractcanvasnode.DeleteCanvasEdgeRequest,
) (*contractcanvasnode.DeleteCanvasEdgeResponse, error) {
	if err := requireAction(ctx, "DeleteCanvasEdge"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if h.graph == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	result, err := h.graph.DeleteEdge(ctx, applicationcanvasnode.DeleteEdgeInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		TargetNodeID: r.TargetNodeID, EdgeID: r.EdgeID,
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), []domaincanvasnode.CanvasNode{result.TargetNode})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.DeleteCanvasEdgeResponse{TargetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision}, nil
}

func (h *CanvasNodeHandler) ReorderStoryboardNodes(
	ctx context.Context,
	r *contractcanvasnode.ReorderStoryboardNodesRequest,
) (*contractcanvasnode.ReorderStoryboardNodesResponse, error) {
	if err := requireAction(ctx, "ReorderStoryboardNodes"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	items := make([]applicationcanvasnode.StoryboardRank, 0, len(r.Items))
	for _, item := range r.Items {
		if item == nil {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		items = append(items, applicationcanvasnode.StoryboardRank{NodeID: item.NodeID, Rank: item.StoryboardRank})
	}
	if h.graph == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	result, err := h.graph.ReorderStoryboard(ctx, applicationcanvasnode.ReorderStoryboardInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		Items: items,
	})
	if err != nil {
		return nil, err
	}
	views, err := h.canvas_nodes.ProjectViews(ctx, canvasnodeScope(ctx, r.WorkspaceID), result.Nodes)
	if err != nil {
		return nil, err
	}
	nodes := make([]*contractcanvasnode.CanvasNode, 0, len(views))
	for index, view := range views {
		nodes = append(nodes, canvasnodeViewDTO(view, int32(index+1), applicationcanvasgeneration.GenerationFailure{}))
	}
	return &contractcanvasnode.ReorderStoryboardNodesResponse{Nodes: nodes, CanvasRevision: result.CanvasRevision}, nil
}
func (h *CanvasNodeHandler) SearchCanvasNodeAssets(ctx context.Context, r *contractcanvasnode.SearchCanvasNodeAssetsRequest) (*contractcanvasnode.SearchCanvasNodeAssetsResponse, error) {
	if err := requireAction(ctx, "SearchCanvasNodeAssets"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	mediaTypes, ok := canvasNodeMediaTypesFromDTO(r.MediaTypes)
	if !ok {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	searchResult, err := h.assets.Search(
		ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.GetKeyword(),
		r.GetCursor(), int(r.Limit), mediaTypes,
	)
	if err != nil {
		return nil, err
	}
	connectedNodes := make([]*contractcanvasnode.CanvasNodeAssetMentionNode, 0)
	canvasNodes := make([]*contractcanvasnode.CanvasNodeAssetMentionNode, 0)
	for _, item := range searchResult.CanvasNodes {
		node := canvasNodeMentionLeafDTO(item)
		if item.Connected {
			connectedNodes = append(connectedNodes, node)
		} else {
			canvasNodes = append(canvasNodes, node)
		}
	}
	projectNodes := make([]*contractcanvasnode.CanvasNodeAssetMentionNode, 0, len(searchResult.Items))
	for _, item := range searchResult.Items {
		if len(item.Assets) == 0 {
			continue
		}
		projectNodes = append(projectNodes, canvasnodeAssetMentionProjectDTO(item))
	}
	items := []*contractcanvasnode.CanvasNodeAssetMentionNode{
		{ID: "references", Label: "引用", Children: connectedNodes},
		{ID: "nodes", Label: "节点", Children: canvasNodes},
		{ID: "assets", Label: "资产", Children: projectNodes},
	}
	return &contractcanvasnode.SearchCanvasNodeAssetsResponse{
		Items:      items,
		NextCursor: optionalString(searchResult.NextCursor),
	}, nil
}

func canvasNodeMediaTypesFromDTO(values []contractcanvasnode.CanvasNodeMediaType) ([]domaincanvasnode.MediaType, bool) {
	if len(values) == 0 {
		return nil, true
	}
	result := make([]domaincanvasnode.MediaType, 0, len(values))
	for _, value := range values {
		mediaType := domaincanvasnode.MediaType(value)
		if mediaType < domaincanvasnode.MediaTypeImage || mediaType > domaincanvasnode.MediaTypeText {
			return nil, false
		}
		result = append(result, mediaType)
	}
	return result, true
}

func canvasnodeAssetMentionProjectDTO(item applicationcanvasnode.CanvasNodeAvailableAsset) *contractcanvasnode.CanvasNodeAssetMentionNode {
	if item.ResourceType != domainresource.TypeAudio {
		return canvasnodeAssetMentionGroupDTO(item)
	}
	for _, child := range item.Assets {
		if !child.Primary {
			continue
		}
		result := canvasnodeAssetMentionLeafDTO(child, item.Name)
		result.ID = item.ResourceID
		result.ResourceID = optionalString(item.ResourceID)
		result.ResourceAssetID = nil
		referenceType := contractcanvasnode.CanvasNodeMentionReferenceType_RESOURCE
		result.ReferenceType = &referenceType
		resourceType := contractresource.ResourceType(item.ResourceType)
		result.ResourceType = &resourceType
		result.Description = optionalString(item.Description)
		return result
	}
	return canvasnodeAssetMentionGroupDTO(item)
}

func canvasnodeAssetMentionGroupDTO(item applicationcanvasnode.CanvasNodeAvailableAsset) *contractcanvasnode.CanvasNodeAssetMentionNode {
	children := make([]*contractcanvasnode.CanvasNodeAssetMentionNode, 0, len(item.Assets))
	var previewURL *string
	resourceType := contractresource.ResourceType(item.ResourceType)
	for _, child := range item.Assets {
		childDTO := canvasnodeAssetMentionLeafDTO(child, child.Name)
		childDTO.ResourceType = &resourceType
		children = append(children, childDTO)
		if child.Primary {
			previewURL = optionalString(child.PreviewURL)
		}
	}
	return &contractcanvasnode.CanvasNodeAssetMentionNode{
		ID: item.ResourceID, Label: item.Name, Children: children,
		Description: optionalString(item.Description), URL: previewURL, ResourceType: &resourceType,
	}
}

func canvasnodeAssetMentionLeafDTO(child applicationcanvasnode.CanvasNodeAvailableAssetItem, label string) *contractcanvasnode.CanvasNodeAssetMentionNode {
	mediaType := contractasset.AssetMediaType(child.Asset.MediaType)
	referenceType := contractcanvasnode.CanvasNodeMentionReferenceType_RESOURCE_ASSET
	available := child.Asset.ID != ""
	id := child.Asset.ID
	if id == "" {
		id = child.ResourceAssetID
	}
	result := &contractcanvasnode.CanvasNodeAssetMentionNode{
		Available: &available, Generating: &child.Generating, AssetID: optionalString(child.Asset.ID),
		ID: id, Label: label, Children: make([]*contractcanvasnode.CanvasNodeAssetMentionNode, 0),
		Description: optionalString(formatAssetSize(child.Asset.SizeBytes)), MediaType: &mediaType,
		URL: optionalString(child.PreviewURL), ResourceAssetID: optionalString(child.ResourceAssetID),
		ReferenceType: &referenceType, Reviews: assetReviewDTOs(child.Asset.Reviews),
	}
	return result
}

func canvasNodeMentionLeafDTO(item applicationcanvasnode.CanvasNodeMention) *contractcanvasnode.CanvasNodeAssetMentionNode {
	nodeType := contractcanvasnode.CanvasNodeType(item.Node.Type)
	referenceType := contractcanvasnode.CanvasNodeMentionReferenceType_CANVAS_NODE
	result := &contractcanvasnode.CanvasNodeAssetMentionNode{
		ID: item.Node.ID, CanvasNodeID: optionalString(item.Node.ID), NodeType: &nodeType,
		Label: item.Node.Name, Children: make([]*contractcanvasnode.CanvasNodeAssetMentionNode, 0),
		URL: optionalString(item.PreviewURL), ResourceAssetID: optionalString(item.Node.ResourceAssetID), ReferenceType: &referenceType,
	}
	if result.Label == "" {
		result.Label = canvasNodeTypeLabel(item.Node.Type)
	}
	if item.Asset != nil {
		mediaType := contractasset.AssetMediaType(item.Asset.MediaType)
		result.MediaType = &mediaType
		result.AssetID = optionalString(item.Asset.ID)
		result.Description = optionalString(formatAssetSize(item.Asset.SizeBytes))
		result.Reviews = assetReviewDTOs(item.Asset.Reviews)
	} else {
		result.Description = optionalString(strings.TrimSpace(item.Node.Text))
		if result.GetDescription() == "" {
			result.Description = optionalString(strings.TrimSpace(item.Node.Prompt))
		}
	}
	return result
}

func canvasNodeTypeLabel(nodeType domaincanvasnode.NodeType) string {
	switch nodeType {
	case domaincanvasnode.NodeTypeImageAsset:
		return "图片"
	case domaincanvasnode.NodeTypeVideoAsset:
		return "视频"
	case domaincanvasnode.NodeTypeAudioAsset:
		return "音频"
	case domaincanvasnode.NodeTypeText:
		return "文本"
	case domaincanvasnode.NodeTypeImageGeneration:
		return "图片生成"
	case domaincanvasnode.NodeTypeVideoGeneration:
		return "视频生成"
	case domaincanvasnode.NodeTypeTextGeneration:
		return "文本生成"
	default:
		return "节点"
	}
}

func formatAssetSize(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", max(size, 0))
	}
	if size < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(size)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
}
func canvasnodeScope(ctx context.Context, w *string) applicationcanvasnode.Scope {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return applicationcanvasnode.Scope{TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(w), CallerID: metadata.UserID}
}
func configPatchFromDTO(v *contractcanvasnode.CanvasNodeGenerationConfigPatch) domainvideo.ConfigPatch {
	patch := domainvideo.ConfigPatch{ModelServiceID: v.ModelServiceID, DurationSeconds: v.DurationSeconds, GenerateAudio: v.GenerateAudio, Watermark: v.Watermark}
	if v.Resolution != nil {
		resolution := domainvideo.Resolution(*v.Resolution)
		patch.Resolution = &resolution
	}
	if v.AspectRatio != nil {
		aspectRatio := domainvideo.AspectRatio(*v.AspectRatio)
		patch.AspectRatio = &aspectRatio
	}
	return patch
}
func generationConfigFromDTO(v *contractcanvasnode.CanvasNodeGenerationConfig) domainvideo.Config {
	return domainvideo.Config{
		ModelServiceID: v.ModelServiceID, Resolution: domainvideo.Resolution(v.Resolution),
		AspectRatio: domainvideo.AspectRatio(v.AspectRatio), DurationSeconds: v.DurationSeconds,
		GenerateAudio: v.GenerateAudio, Watermark: v.Watermark,
	}
}
func generationConfigDTO(v domainvideo.Config) *contractcanvasnode.CanvasNodeGenerationConfig {
	return &contractcanvasnode.CanvasNodeGenerationConfig{
		ModelServiceID: v.ModelServiceID, Resolution: contractcanvasnode.CanvasNodeResolution(v.Resolution),
		AspectRatio: contractcanvasnode.CanvasNodeAspectRatio(v.AspectRatio), DurationSeconds: v.DurationSeconds,
		GenerateAudio: v.GenerateAudio, Watermark: v.Watermark,
	}
}
func canvasnodeDTO(v domaincanvasnode.CanvasNode, no int32) *contractcanvasnode.CanvasNode {
	// ActiveTaskRunID directly exposes the node's current TaskRun for polling and cancellation.
	status := contractcanvasnode.CanvasNodeStatus_EMPTY
	if v.ActiveTaskRunID != "" {
		status = contractcanvasnode.CanvasNodeStatus_GENERATING
	} else if v.SelectedOutputID != "" || v.SelectedAssetID != "" || v.SelectedOutputText != "" || v.ResourceAssetID != "" || v.ResourceID != "" {
		status = contractcanvasnode.CanvasNodeStatus_READY
	}
	var generationConfig *contractcanvasnode.CanvasNodeGenerationConfig
	if v.Type == domaincanvasnode.NodeTypeVideoGeneration || v.Type == domaincanvasnode.NodeTypeImageGeneration || v.Type == domaincanvasnode.NodeTypeTextGeneration {
		generationConfig = generationConfigDTO(v.GenerationConfig)
	}
	edges := make([]*contractcanvasnode.CanvasEdge, 0, len(v.IncomingEdges))
	for _, edge := range v.IncomingEdges {
		edges = append(edges, canvasEdgeDTO(edge))
	}
	return &contractcanvasnode.CanvasNode{NodeID: v.ID, CanvasID: v.CanvasID, CanvasNodeNo: no, Prompt: v.Prompt,
		GenerationConfig: generationConfig, Status: status, SelectedOutputID: optionalCanvasNodeString(v.SelectedOutputID),
		SelectedAssetID: optionalCanvasNodeString(v.SelectedAssetID), ActiveTaskRunID: optionalCanvasNodeString(v.ActiveTaskRunID),
		FirstFrameAssetID: optionalCanvasNodeString(v.FirstFrameAssetID), FirstFrameURL: optionalCanvasNodeString(v.FirstFrameURL),
		LastFrameAssetID:  optionalCanvasNodeString(v.LastFrameAssetID),
		SelectedOutputURL: optionalCanvasNodeString(v.SelectedOutputURL), SelectedOutputDurationSeconds: v.SelectedOutputDurationSeconds,
		SelectedOutputText: optionalCanvasNodeString(v.SelectedOutputText),
		CreatedAt:          timestamp(v.CreatedAt), UpdatedAt: timestamp(v.UpdatedAt),
		CreatedBy: v.CreatedBy, UpdatedBy: v.UpdatedBy, Type: contractcanvasnode.CanvasNodeType(v.Type), Name: v.Name,
		Position:       &contractcanvasnode.CanvasNodePosition{PositionX: v.Position.PositionX, PositionY: v.Position.PositionY},
		StoryboardRank: optionalInt64(v.StoryboardRank), Text: optionalCanvasNodeString(v.Text), AssetID: optionalCanvasNodeString(v.AssetID),
		ResourceID: optionalCanvasNodeString(v.ResourceID), ResourceAssetID: optionalCanvasNodeString(v.ResourceAssetID),
		CurrentAssetID: optionalCanvasNodeString(v.CurrentAssetID), ResourceAssetRevision: optionalInt64(v.ResourceAssetRevision),
		ResourceAssetIsPrimary: optionalBool(v.ResourceAssetIsPrimary),
		ReferenceType:          canvasNodeReferenceTypeDTO(v.ReferenceType),
		ReferenceStatus:        canvasNodeReferenceStatusDTO(v.ReferenceStatus),
		VideoInputMode:         optionalVideoInputMode(v), IncomingEdges: edges, Revision: v.Revision}
}

func canvasnodeViewDTO(view applicationcanvasnode.CanvasNodeView, no int32, failure applicationcanvasgeneration.GenerationFailure) *contractcanvasnode.CanvasNode {
	result := canvasnodeDTO(view.CanvasNode, no)
	if view.ActiveTaskRunID != "" {
		kind := contractcanvasnode.CanvasNodeTaskType_GENERATION
		if view.AssetsMatching {
			kind = contractcanvasnode.CanvasNodeTaskType_ASSETS_MATCH
			result.Status = contractcanvasnode.CanvasNodeStatus_EMPTY
			if view.SelectedOutputID != "" || view.SelectedAssetID != "" || view.SelectedOutputText != "" || view.ResourceAssetID != "" || view.ResourceID != "" {
				result.Status = contractcanvasnode.CanvasNodeStatus_READY
			}
		}
		result.ActiveTaskType = &kind
	}

	result.PreviewURL = optionalString(view.PreviewURL)
	result.Reviews = assetReviewDTOs(view.Reviews)
	if failure.TaskRunID != "" {
		result.LatestGenerationFailure = &contractcanvasnode.CanvasNodeGenerationFailure{
			TaskRunID: failure.TaskRunID, ErrorCode: optionalString(failure.ErrorCode), ErrorMessage: optionalString(failure.ErrorMessage), SeedanceTaskID: optionalString(failure.SeedanceTaskID),
		}
	}
	return result
}

func canvasNodeReferenceStatusDTO(value domaincanvasnode.ReferenceStatus) contractcanvasnode.CanvasNodeReferenceStatus {
	switch value {
	case domaincanvasnode.ReferenceStatusActive:
		return contractcanvasnode.CanvasNodeReferenceStatus_ACTIVE
	case domaincanvasnode.ReferenceStatusDeleted:
		return contractcanvasnode.CanvasNodeReferenceStatus_DELETED
	default:
		return contractcanvasnode.CanvasNodeReferenceStatus_ACTIVE
	}
}

func canvasNodeReferenceTypeDTO(value domaincanvasnode.ReferenceType) *contractcanvasnode.CanvasNodeMentionReferenceType {
	var result contractcanvasnode.CanvasNodeMentionReferenceType
	switch value {
	case domaincanvasnode.ReferenceTypeAsset:
		result = contractcanvasnode.CanvasNodeMentionReferenceType_ASSET
	case domaincanvasnode.ReferenceTypeResource:
		result = contractcanvasnode.CanvasNodeMentionReferenceType_RESOURCE
	case domaincanvasnode.ReferenceTypeResourceAsset:
		result = contractcanvasnode.CanvasNodeMentionReferenceType_RESOURCE_ASSET
	default:
		return nil
	}
	return &result
}

func optionalBool(value bool) *bool { return &value }

func canvasEdgeDTO(edge domaincanvasnode.IncomingEdge) *contractcanvasnode.CanvasEdge {
	return &contractcanvasnode.CanvasEdge{EdgeID: edge.ID, SourceNodeID: edge.SourceNodeID,
		SourcePort: contractcanvasnode.CanvasPort_OUTPUT, TargetPort: portDTO(edge.TargetPort), TargetOrder: edge.TargetOrder}
}

func portDTO(port domaincanvasnode.Port) contractcanvasnode.CanvasPort {
	switch port {
	case domaincanvasnode.PortReferenceImage:
		return contractcanvasnode.CanvasPort_REFERENCE_IMAGE
	case domaincanvasnode.PortReferenceVideo:
		return contractcanvasnode.CanvasPort_REFERENCE_VIDEO
	case domaincanvasnode.PortReferenceAudio:
		return contractcanvasnode.CanvasPort_REFERENCE_AUDIO
	case domaincanvasnode.PortReferenceText:
		return contractcanvasnode.CanvasPort_REFERENCE_TEXT
	case domaincanvasnode.PortFirstFrame:
		return contractcanvasnode.CanvasPort_FIRST_FRAME
	case domaincanvasnode.PortLastFrame:
		return contractcanvasnode.CanvasPort_LAST_FRAME
	default:
		return contractcanvasnode.CanvasPort_OUTPUT
	}
}

func portFromDTO(port contractcanvasnode.CanvasPort) (domaincanvasnode.Port, bool) {
	switch port {
	case contractcanvasnode.CanvasPort_REFERENCE_IMAGE:
		return domaincanvasnode.PortReferenceImage, true
	case contractcanvasnode.CanvasPort_REFERENCE_VIDEO:
		return domaincanvasnode.PortReferenceVideo, true
	case contractcanvasnode.CanvasPort_REFERENCE_AUDIO:
		return domaincanvasnode.PortReferenceAudio, true
	case contractcanvasnode.CanvasPort_REFERENCE_TEXT:
		return domaincanvasnode.PortReferenceText, true
	case contractcanvasnode.CanvasPort_FIRST_FRAME:
		return domaincanvasnode.PortFirstFrame, true
	case contractcanvasnode.CanvasPort_LAST_FRAME:
		return domaincanvasnode.PortLastFrame, true
	default:
		return "", false
	}
}

func optionalInt64(value int64) *int64 {
	if value == 0 {
		return nil
	}
	return &value
}

func mentionReferenceTypeFromDTO(value *contractcanvasnode.CanvasNodeMentionReferenceType) (*applicationcanvasnode.MentionReferenceType, bool) {
	if value == nil {
		return nil, true
	}
	var result applicationcanvasnode.MentionReferenceType
	switch *value {
	case contractcanvasnode.CanvasNodeMentionReferenceType_UNSPECIFIED:
		result = applicationcanvasnode.MentionReferenceTypeUnspecified
	case contractcanvasnode.CanvasNodeMentionReferenceType_ASSET:
		result = applicationcanvasnode.MentionReferenceTypeAsset
	case contractcanvasnode.CanvasNodeMentionReferenceType_RESOURCE:
		result = applicationcanvasnode.MentionReferenceTypeResource
	case contractcanvasnode.CanvasNodeMentionReferenceType_RESOURCE_ASSET:
		result = applicationcanvasnode.MentionReferenceTypeResourceAsset
	case contractcanvasnode.CanvasNodeMentionReferenceType_CANVAS_NODE:
		result = applicationcanvasnode.MentionReferenceTypeCanvasNode
	default:
		return nil, false
	}
	return &result, true
}

func optionalVideoInputMode(node domaincanvasnode.CanvasNode) *contractcanvasnode.CanvasVideoInputMode {
	if node.Type != domaincanvasnode.NodeTypeVideoGeneration {
		return nil
	}
	value := contractcanvasnode.CanvasVideoInputMode(node.VideoInputMode)
	return &value
}

func optionalCanvasNodeString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func historyDTO(run applicationvideogeneration.TaskRun) *contractcanvasnode.CanvasNodeHistory {
	var completedAt *string
	if run.FinishedAt != nil {
		value := timestamp(*run.FinishedAt)
		completedAt = &value
	}
	resolution := contractcanvasnode.CanvasNodeResolution(run.Resolution)
	aspectRatio := contractcanvasnode.CanvasNodeAspectRatio(run.AspectRatio)
	durationSeconds := run.DurationSeconds
	generateAudio := run.GenerateAudio
	watermark := run.Watermark
	dto := &contractcanvasnode.CanvasNodeHistory{
		HistoryID: run.TaskRunID, Status: generationStatusDTO(run.Status), ProviderStatus: providerStatusDTO(run.ProviderStatus),
		ModelServiceID:  run.ModelServiceID,
		Resolution:      &resolution,
		AspectRatio:     &aspectRatio,
		DurationSeconds: &durationSeconds,
		GenerateAudio:   &generateAudio, Watermark: &watermark,
		Prompt: run.Prompt, VideoURL: optionalCanvasNodeString(run.VideoURL),
		ErrorCode:    optionalCanvasNodeString(run.ErrorCode),
		ErrorMessage: optionalCanvasNodeString(run.ErrorMessage),
		CompletedAt:  completedAt, CreatedAt: timestamp(run.CreatedAt),
		FirstFrameAssetID:      optionalCanvasNodeString(run.FirstFrameAssetID),
		LastFrameAssetID:       optionalCanvasNodeString(run.LastFrameAssetID),
		FirstFrameURL:          optionalCanvasNodeString(run.FirstFrameURL),
		LastFrameURL:           optionalCanvasNodeString(run.LastFrameURL),
		ResourceAssetSnapshots: resourceAssetSnapshotDTOs(run.Inputs),
		Type:                   contractcanvasnode.CanvasNodeType(run.NodeType),
		OutputAssetID:          optionalCanvasNodeString(run.OutputAssetID),
		OutputURL:              optionalCanvasNodeString(run.VideoURL),
		OutputText:             optionalCanvasNodeString(run.OutputText),
	}
	if run.NodeType == domaincanvasnode.NodeTypeVideoGeneration && run.ProviderStatus == domainvideo.ProviderStatusFailed {
		dto.SeedanceTaskID = optionalCanvasNodeString(run.SeedanceTaskID)
	}
	return dto
}

func resourceAssetSnapshotDTOs(items []domaingenerationinput.Input) []*contractcanvasnode.CanvasNodeGenerationResourceAssetSnapshot {
	result := make([]*contractcanvasnode.CanvasNodeGenerationResourceAssetSnapshot, 0, len(items))
	for _, item := range items {
		if item.ResourceAssetID == "" {
			continue
		}
		result = append(result, &contractcanvasnode.CanvasNodeGenerationResourceAssetSnapshot{
			SourceNodeID: item.SourceNodeID, ResourceAssetID: item.ResourceAssetID,
			ResourceAssetRevision: item.ResourceAssetRevision, AssetID: item.AssetID,
		})
	}
	return result
}

func providerStatusDTO(status domainvideo.ProviderStatus) contractcanvasnode.CanvasNodeVideoProviderStatus {
	statuses := map[domainvideo.ProviderStatus]contractcanvasnode.CanvasNodeVideoProviderStatus{
		domainvideo.ProviderStatusPending:   contractcanvasnode.CanvasNodeVideoProviderStatus_PENDING,
		domainvideo.ProviderStatusQueued:    contractcanvasnode.CanvasNodeVideoProviderStatus_QUEUED,
		domainvideo.ProviderStatusRunning:   contractcanvasnode.CanvasNodeVideoProviderStatus_RUNNING,
		domainvideo.ProviderStatusSucceeded: contractcanvasnode.CanvasNodeVideoProviderStatus_SUCCEEDED,
		domainvideo.ProviderStatusFailed:    contractcanvasnode.CanvasNodeVideoProviderStatus_FAILED,
		domainvideo.ProviderStatusCancelled: contractcanvasnode.CanvasNodeVideoProviderStatus_CANCELLED,
		domainvideo.ProviderStatusUnknown:   contractcanvasnode.CanvasNodeVideoProviderStatus_UNKNOWN,
	}
	if value, ok := statuses[status]; ok {
		return value
	}
	return contractcanvasnode.CanvasNodeVideoProviderStatus_UNKNOWN
}

func generationStatusDTO(status string) contractcanvasnode.CanvasGenerationStatus {
	statuses := map[string]contractcanvasnode.CanvasGenerationStatus{
		"queued":    contractcanvasnode.CanvasGenerationStatus_QUEUED,
		"running":   contractcanvasnode.CanvasGenerationStatus_RUNNING,
		"succeeded": contractcanvasnode.CanvasGenerationStatus_SUCCEEDED,
		"failed":    contractcanvasnode.CanvasGenerationStatus_FAILED,
		"cancelled": contractcanvasnode.CanvasGenerationStatus_CANCELLED,
	}
	if value, ok := statuses[status]; ok {
		return value
	}
	return contractcanvasnode.CanvasGenerationStatus_FAILED
}

func (h *CanvasNodeHandler) StartCanvasNodeAssetsMatch(ctx context.Context, r *contractcanvasnode.StartCanvasNodeAssetsMatchRequest) (*contractcanvasnode.StartCanvasNodeAssetsMatchResponse, error) {
	if err := requireAction(ctx, "StartCanvasNodeAssetsMatch"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	run, err := h.canvas_nodes.StartAssetsMatch(ctx, applicationcanvasnode.StartAssetsMatchInput{Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID, NodeID: r.NodeID, Revision: r.Revision})
	if err != nil {
		return nil, err
	}
	return &contractcanvasnode.StartCanvasNodeAssetsMatchResponse{TaskRunID: run.ID}, nil
}

func (h *CanvasNodeHandler) BatchGetCanvasNodeStates(ctx context.Context, r *contractcanvasnode.BatchGetCanvasNodeStatesRequest) (*contractcanvasnode.BatchGetCanvasNodeStatesResponse, error) {
	if err := requireAction(ctx, "BatchGetCanvasNodeStates"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	scope := canvasnodeScope(ctx, r.WorkspaceID)
	targets := make([]applicationcanvasgeneration.GenerationTarget, 0, len(r.Targets))
	for _, target := range r.Targets {
		if target == nil {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		targets = append(targets, applicationcanvasgeneration.GenerationTarget{NodeID: target.NodeID, TaskRunID: target.TaskRunID})
	}
	states, err := h.generations.BatchGetStates(ctx, scope, r.ProjectID, r.CanvasID, targets)
	if err != nil {
		return nil, err
	}
	// Project only requested nodes and the source nodes needed by completed matches.
	ids := make([]string, 0, len(states))
	seen := map[string]bool{}
	add := func(id string) {
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	for _, state := range states {
		add(state.Node.ID)
	}
	views, err := h.canvas_nodes.BatchGetViews(ctx, scope, r.ProjectID, r.CanvasID, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*contractcanvasnode.CanvasNode, len(views))
	for _, view := range views {
		byID[view.ID] = canvasnodeViewDTO(view, 0, applicationcanvasgeneration.GenerationFailure{})
	}
	// Derive required sources from the same node projection returned to the client.
	// A task may commit between the initial task read and this node read.
	sourceIDs := make([]string, 0)
	for _, state := range states {
		if state.Run.RunType != domaintask.RunTypeCanvasNodeAssetsMatch {
			continue
		}
		if node := byID[state.Node.ID]; node != nil {
			for _, edge := range node.IncomingEdges {
				if !seen[edge.SourceNodeID] {
					seen[edge.SourceNodeID] = true
					sourceIDs = append(sourceIDs, edge.SourceNodeID)
				}
			}
		}
	}
	if len(sourceIDs) > 0 {
		sources, readErr := h.canvas_nodes.BatchGetViews(ctx, scope, r.ProjectID, r.CanvasID, sourceIDs)
		if readErr != nil {
			return nil, readErr
		}
		for _, source := range sources {
			byID[source.ID] = canvasnodeViewDTO(source, 0, applicationcanvasgeneration.GenerationFailure{})
		}
	}
	items := make([]*contractcanvasnode.CanvasNodeState, 0, len(states))
	for _, state := range states {
		node := byID[state.Node.ID]
		if node == nil {
			continue
		}
		item := &contractcanvasnode.CanvasNodeState{NodeID: node.NodeID, TaskRunID: state.Run.ID, Status: generationStatusDTO(string(state.Run.Status)), TaskType: contractcanvasnode.CanvasNodeTaskType_GENERATION, Node: node, RelatedNodes: []*contractcanvasnode.CanvasNode{}, ErrorCode: optionalString(state.Run.ErrorCode), ErrorMessage: optionalString(state.Run.ErrorMessage), SeedanceTaskID: optionalString(state.SeedanceTaskID)}
		if state.Run.RunType == domaintask.RunTypeCanvasNodeAssetsMatch {
			item.TaskType = contractcanvasnode.CanvasNodeTaskType_ASSETS_MATCH
			for _, edge := range node.IncomingEdges {
				if source := byID[edge.SourceNodeID]; source != nil {
					item.RelatedNodes = append(item.RelatedNodes, source)
				}
			}
		}
		if !state.Run.Terminal() && node.ActiveTaskRunID == nil {
			// A node can commit after the task read, or while video frame extraction is pending.
			node.ActiveTaskRunID = &item.TaskRunID
			node.ActiveTaskType = &item.TaskType
			if item.TaskType == contractcanvasnode.CanvasNodeTaskType_GENERATION {
				node.Status = contractcanvasnode.CanvasNodeStatus_GENERATING
			}
		}
		if state.VideoProviderStatus != nil {
			status := providerStatusDTO(*state.VideoProviderStatus)
			item.VideoProviderStatus = &status
		}
		items = append(items, item)
	}
	return &contractcanvasnode.BatchGetCanvasNodeStatesResponse{Items: items}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeAssetsMatch(ctx context.Context, r *contractcanvasnode.CancelCanvasNodeAssetsMatchRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeAssetsMatch"); err != nil {
		return nil, err
	}
	r.Top = topParam(ctx)
	if err := h.canvas_nodes.CancelAssetsMatch(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}
