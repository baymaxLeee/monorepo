package http

import (
	"context"
	"fmt"
	"strings"
	"time"

	arkmodel "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"

	thriftasset "github.com/example/monorepo/canvas/internal/api/contracts/asset"
	thriftbase "github.com/example/monorepo/canvas/internal/api/contracts/base"
	thriftcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	thriftresource "github.com/example/monorepo/canvas/internal/api/contracts/resource"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcanvasgeneration "github.com/example/monorepo/canvas/internal/application/canvasgeneration"
	applicationcanvastextgeneration "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvasnode "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
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
	ConfirmStoryboardDrafts(context.Context, applicationcanvasnode.Scope, string, string, string, []applicationcanvasnode.CanvasNodeDraftConfirmInput) ([]domaincanvasnode.CanvasNode, int64, error)
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

func (h *CanvasNodeHandler) MaterializeCanvasStandaloneAssetReference(ctx context.Context, r *thriftcanvasnode.MaterializeCanvasStandaloneAssetReferenceRequest) (*thriftcanvasnode.MaterializeCanvasStandaloneAssetReferenceResponse, error) {
	if err := requireAction(ctx, "MaterializeCanvasStandaloneAssetReference"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.MaterializeCanvasStandaloneAssetReferenceResponse{AssetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), TargetNode: canvasnodeViewDTO(views[1], 0, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision, CreatedAssetNode: result.CreatedAssetNode}, nil
}

func (h *CanvasNodeHandler) MaterializeCanvasResourceAssetReference(
	ctx context.Context,
	r *thriftcanvasnode.MaterializeCanvasResourceAssetReferenceRequest,
) (*thriftcanvasnode.MaterializeCanvasResourceAssetReferenceResponse, error) {
	if err := requireAction(ctx, "MaterializeCanvasResourceAssetReference"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.MaterializeCanvasResourceAssetReferenceResponse{
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
	r *thriftcanvasnode.CreateCanvasAssetRequest,
) (*thriftcanvasnode.CreateCanvasAssetResponse, error) {
	if err := requireAction(ctx, "CreateCanvasAsset"); err != nil {
		return nil, err
	}
	item, err := h.assets.CreateCanvasAsset(ctx, applicationcanvasnode.CreateCanvasAssetInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID,
		SourceAssetID: r.SourceAssetID, SourceRevisionID: r.SourceRevisionID, FileName: r.FileName,
	})
	if err != nil {
		return nil, err
	}
	return &thriftcanvasnode.CreateCanvasAssetResponse{Asset: assetDTO(item)}, nil
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
	List(context.Context, applicationcanvasnode.Scope, string, string) ([]applicationcanvasnode.StoryboardSession, error)
	Cancel(context.Context, applicationcanvasnode.Scope, string, string, string) error
	Confirm(context.Context, applicationcanvasnode.Scope, string, string, string, []applicationcanvasnode.StoryboardOverride) ([]domaincanvasnode.CanvasNode, int64, error)
}

func (h *CanvasNodeHandler) CreateCanvasNodes(ctx context.Context, r *thriftcanvasnode.CreateCanvasNodesRequest) (*thriftcanvasnode.CreateCanvasNodesResponse, error) {
	if err := requireAction(ctx, "CreateCanvasNodes"); err != nil {
		return nil, err
	}
	modelConfig := storyboardModelConfigFromRequest(r)
	planningConfig := storyboardPlanningConfigFromRequest(r)
	state, err := h.drafts.Start(
		ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.Plot,
		modelConfig, planningConfig, 0,
	)
	if err != nil {
		return nil, err
	}
	return &thriftcanvasnode.CreateCanvasNodesResponse{Session: draftSessionDTO(state, true)}, nil
}

func (h *CanvasNodeHandler) ConfirmCanvasNodeDrafts(ctx context.Context, r *thriftcanvasnode.ConfirmCanvasNodeDraftsRequest) (*thriftcanvasnode.ConfirmCanvasNodeDraftsResponse, error) {
	if err := requireAction(ctx, "ConfirmCanvasNodeDrafts"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.ConfirmCanvasNodeDraftsResponse{CanvasNodeIDs: canvasNodeIDs, CanvasRevision: canvasRevision}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeDrafts(ctx context.Context, r *thriftcanvasnode.CancelCanvasNodeDraftsRequest) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeDrafts"); err != nil {
		return nil, err
	}
	if err := h.drafts.Cancel(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
}

func (h *CanvasNodeHandler) StartCanvasNodeGeneration(ctx context.Context, r *thriftcanvasnode.StartCanvasNodeGenerationRequest) (*thriftcanvasnode.StartCanvasNodeGenerationResponse, error) {
	if err := requireAction(ctx, "StartCanvasNodeGeneration"); err != nil {
		return nil, err
	}
	taskRunID, err := h.generations.Start(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID)
	if err != nil {
		return nil, err
	}
	return &thriftcanvasnode.StartCanvasNodeGenerationResponse{TaskRunID: taskRunID}, nil
}

func (h *CanvasNodeHandler) StartCanvasGeneration(ctx context.Context, r *thriftcanvasnode.StartCanvasGenerationRequest) (*thriftcanvasnode.StartCanvasGenerationResponse, error) {
	if err := requireAction(ctx, "StartCanvasGeneration"); err != nil {
		return nil, err
	}
	started, skipped, err := h.generations.StartCanvas(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID)
	if err != nil {
		return nil, err
	}
	items := make([]*thriftcanvasnode.CanvasNodeGenerationStart, 0, len(started))
	for _, item := range started {
		items = append(items, &thriftcanvasnode.CanvasNodeGenerationStart{NodeID: item.NodeID, TaskRunID: item.TaskRunID})
	}
	return &thriftcanvasnode.StartCanvasGenerationResponse{Items: items, SkippedCount: int32(skipped)}, nil
}

func (h *CanvasNodeHandler) ListCanvasNodeHistories(ctx context.Context, r *thriftcanvasnode.ListCanvasNodeHistoriesRequest) (*thriftcanvasnode.ListCanvasNodeHistoriesResponse, error) {
	if err := requireAction(ctx, "ListCanvasNodeHistories"); err != nil {
		return nil, err
	}
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
	out := make([]*thriftcanvasnode.CanvasNodeHistory, 0, len(items))
	for index := range items {
		out = append(out, historyDTO(items[index]))
	}
	return &thriftcanvasnode.ListCanvasNodeHistoriesResponse{Items: out}, nil
}

func (h *CanvasNodeHandler) SelectCanvasNodeHistory(ctx context.Context, r *thriftcanvasnode.SelectCanvasNodeHistoryRequest) (*thriftcanvasnode.SelectCanvasNodeHistoryResponse, error) {
	if err := requireAction(ctx, "SelectCanvasNodeHistory"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.SelectCanvasNodeHistoryResponse{
		History: historyDTO(history),
	}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeGeneration(ctx context.Context, r *thriftcanvasnode.CancelCanvasNodeGenerationRequest) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeGeneration"); err != nil {
		return nil, err
	}
	if err := h.generations.Cancel(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
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

func (h *CanvasNodeHandler) StartCanvasNodeTextGeneration(ctx context.Context, r *thriftcanvasnode.StartCanvasNodeTextGenerationRequest) (*thriftcanvasnode.CanvasNodeTextGenerationResponse, error) {
	if err := requireAction(ctx, "StartCanvasNodeTextGeneration"); err != nil {
		return nil, err
	}
	state, err := h.textGenerations.Start(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID)
	if err != nil {
		return nil, err
	}
	return &thriftcanvasnode.CanvasNodeTextGenerationResponse{Session: textGenerationSessionDTO(state)}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeTextGeneration(ctx context.Context, r *thriftcanvasnode.CancelCanvasNodeTextGenerationRequest) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeTextGeneration"); err != nil {
		return nil, err
	}
	if err := h.textGenerations.Cancel(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
}

func textGenerationSessionDTO(state applicationcanvastextgeneration.Session) *thriftcanvasnode.CanvasTextGenerationSession {
	status := thriftcanvasnode.CanvasGenerationStatus_QUEUED
	switch state.Status {
	case applicationcanvastextgeneration.StatusRunning:
		status = thriftcanvasnode.CanvasGenerationStatus_RUNNING
	case applicationcanvastextgeneration.StatusSucceeded:
		status = thriftcanvasnode.CanvasGenerationStatus_SUCCEEDED
	case applicationcanvastextgeneration.StatusFailed:
		status = thriftcanvasnode.CanvasGenerationStatus_FAILED
	case applicationcanvastextgeneration.StatusCancelled:
		status = thriftcanvasnode.CanvasGenerationStatus_CANCELLED
	}
	dto := &thriftcanvasnode.CanvasTextGenerationSession{TaskRunID: state.ID, NodeID: state.NodeID, Status: status, Content: state.Content}
	if state.Failure != nil {
		dto.ErrorCode = optionalCanvasNodeString(state.Failure.Code)
		dto.ErrorMessage = optionalCanvasNodeString(state.Failure.Message)
	}
	return dto
}

func (h *CanvasNodeHandler) GetCanvasGraph(
	ctx context.Context,
	r *thriftcanvasnode.GetCanvasGraphRequest,
) (*thriftcanvasnode.GetCanvasGraphResponse, error) {
	if err := requireAction(ctx, "GetCanvasGraph"); err != nil {
		return nil, err
	}
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
	nodes := make([]*thriftcanvasnode.CanvasNode, 0, len(items))
	videoNo := int32(0)
	for _, item := range items {
		no := int32(0)
		if item.Type == domaincanvasnode.NodeTypeVideoGeneration {
			videoNo++
			no = videoNo
		}
		nodes = append(nodes, canvasnodeViewDTO(item, no, failures[item.ID]))
	}
	if err = h.attachStoryboardDraftSessions(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, nodes); err != nil {
		return nil, err
	}
	return &thriftcanvasnode.GetCanvasGraphResponse{Nodes: nodes}, nil
}

func (h *CanvasNodeHandler) attachStoryboardDraftSessions(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID string,
	nodes []*thriftcanvasnode.CanvasNode,
) error {
	draftNodes := make(map[string]*thriftcanvasnode.CanvasNode)
	for _, node := range nodes {
		if node != nil && node.Type == thriftcanvasnode.CanvasNodeType_STORYBOARD_DRAFT {
			draftNodes[node.NodeID] = node
		}
	}
	if len(draftNodes) == 0 {
		return nil
	}
	drafts, err := h.drafts.List(ctx, scope, projectID, canvasID)
	if err != nil {
		return err
	}
	for _, draft := range drafts {
		if node := draftNodes[draft.ID]; node != nil {
			node.DraftSession = draftSessionDTO(draft, true)
		}
	}
	return nil
}

func (h *CanvasNodeHandler) CreateCanvasNode(ctx context.Context, r *thriftcanvasnode.CreateCanvasNodeRequest) (*thriftcanvasnode.CreateCanvasNodeResponse, error) {
	if err := requireAction(ctx, "CreateCanvasNode"); err != nil {
		return nil, err
	}
	if r.Position == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
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
	return &thriftcanvasnode.CreateCanvasNodeResponse{CanvasNode: canvasnodeViewDTO(views[0], canvasnodeNo, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: canvasRevision}, nil
}

func uploadedAssetInput(value *thriftcanvasnode.CanvasUploadedAsset) *applicationcanvasnode.UploadedAssetInput {
	if value == nil {
		return nil
	}
	return &applicationcanvasnode.UploadedAssetInput{SourceAssetID: value.SourceAssetID, SourceRevisionID: value.SourceRevisionID, FileName: value.FileName}
}

func (h *CanvasNodeHandler) CopyCanvasNode(ctx context.Context, r *thriftcanvasnode.CopyCanvasNodeRequest) (*thriftcanvasnode.CopyCanvasNodeResponse, error) {
	if err := requireAction(ctx, "CopyCanvasNode"); err != nil {
		return nil, err
	}
	if r.Position == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
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
	return &thriftcanvasnode.CopyCanvasNodeResponse{
		CanvasNode: canvasnodeViewDTO(views[0], result.CanvasNodeNo, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision,
	}, nil
}
func (h *CanvasNodeHandler) UpdateCanvasNode(ctx context.Context, r *thriftcanvasnode.UpdateCanvasNodeRequest) (*thriftcanvasnode.UpdateCanvasNodeResponse, error) {
	if err := requireAction(ctx, "UpdateCanvasNode"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.UpdateCanvasNodeResponse{CanvasNode: canvasnodeViewDTO(views[0], result.CanvasNodeNo, applicationcanvasgeneration.GenerationFailure{})}, nil
}

func (h *CanvasNodeHandler) BatchUpdateCanvasNodePositions(ctx context.Context, r *thriftcanvasnode.BatchUpdateCanvasNodePositionsRequest) (*thriftcanvasnode.BatchUpdateCanvasNodePositionsResponse, error) {
	if err := requireAction(ctx, "BatchUpdateCanvasNodePositions"); err != nil {
		return nil, err
	}
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
	items := make([]*thriftcanvasnode.CanvasNode, 0, len(views))
	for _, view := range views {
		items = append(items, canvasnodeViewDTO(view, 0, applicationcanvasgeneration.GenerationFailure{}))
	}
	return &thriftcanvasnode.BatchUpdateCanvasNodePositionsResponse{Items: items}, nil
}
func (h *CanvasNodeHandler) DeleteCanvasNode(ctx context.Context, r *thriftcanvasnode.DeleteCanvasNodeRequest) (*thriftcanvasnode.DeleteCanvasNodeResponse, error) {
	if err := requireAction(ctx, "DeleteCanvasNode"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.DeleteCanvasNodeResponse{CanvasRevision: revision}, nil
}

func (h *CanvasNodeHandler) BatchDeleteCanvasNodes(ctx context.Context, r *thriftcanvasnode.BatchDeleteCanvasNodesRequest) (*thriftcanvasnode.BatchDeleteCanvasNodesResponse, error) {
	if err := requireAction(ctx, "BatchDeleteCanvasNodes"); err != nil {
		return nil, err
	}
	if h.graph == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	revision, err := h.graph.BatchDeleteNodes(ctx, applicationcanvasnode.BatchDeleteNodesInput{
		Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID, NodeIDs: r.NodeIDs,
	})
	if err != nil {
		return nil, err
	}
	return &thriftcanvasnode.BatchDeleteCanvasNodesResponse{CanvasRevision: revision}, nil
}

func (h *CanvasNodeHandler) ConnectCanvasNodes(
	ctx context.Context,
	r *thriftcanvasnode.ConnectCanvasNodesRequest,
) (*thriftcanvasnode.ConnectCanvasNodesResponse, error) {
	if err := requireAction(ctx, "ConnectCanvasNodes"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.ConnectCanvasNodesResponse{
		TargetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision,
	}, nil
}

func (h *CanvasNodeHandler) DeleteCanvasEdge(
	ctx context.Context,
	r *thriftcanvasnode.DeleteCanvasEdgeRequest,
) (*thriftcanvasnode.DeleteCanvasEdgeResponse, error) {
	if err := requireAction(ctx, "DeleteCanvasEdge"); err != nil {
		return nil, err
	}
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
	return &thriftcanvasnode.DeleteCanvasEdgeResponse{TargetNode: canvasnodeViewDTO(views[0], 0, applicationcanvasgeneration.GenerationFailure{}), CanvasRevision: result.CanvasRevision}, nil
}

func (h *CanvasNodeHandler) ReorderStoryboardNodes(
	ctx context.Context,
	r *thriftcanvasnode.ReorderStoryboardNodesRequest,
) (*thriftcanvasnode.ReorderStoryboardNodesResponse, error) {
	if err := requireAction(ctx, "ReorderStoryboardNodes"); err != nil {
		return nil, err
	}
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
	nodes := make([]*thriftcanvasnode.CanvasNode, 0, len(views))
	for index, view := range views {
		nodes = append(nodes, canvasnodeViewDTO(view, int32(index+1), applicationcanvasgeneration.GenerationFailure{}))
	}
	return &thriftcanvasnode.ReorderStoryboardNodesResponse{Nodes: nodes, CanvasRevision: result.CanvasRevision}, nil
}
func (h *CanvasNodeHandler) SearchCanvasNodeAssets(ctx context.Context, r *thriftcanvasnode.SearchCanvasNodeAssetsRequest) (*thriftcanvasnode.SearchCanvasNodeAssetsResponse, error) {
	if err := requireAction(ctx, "SearchCanvasNodeAssets"); err != nil {
		return nil, err
	}
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
	connectedNodes := make([]*thriftcanvasnode.CanvasNodeAssetMentionNode, 0)
	canvasNodes := make([]*thriftcanvasnode.CanvasNodeAssetMentionNode, 0)
	for _, item := range searchResult.CanvasNodes {
		node := canvasNodeMentionLeafDTO(item)
		if item.Connected {
			connectedNodes = append(connectedNodes, node)
		} else {
			canvasNodes = append(canvasNodes, node)
		}
	}
	projectNodes := make([]*thriftcanvasnode.CanvasNodeAssetMentionNode, 0, len(searchResult.Items))
	for _, item := range searchResult.Items {
		if len(item.Assets) == 0 {
			continue
		}
		projectNodes = append(projectNodes, canvasnodeAssetMentionProjectDTO(item))
	}
	items := []*thriftcanvasnode.CanvasNodeAssetMentionNode{
		{ID: "references", Label: "引用", Children: connectedNodes},
		{ID: "nodes", Label: "节点", Children: canvasNodes},
		{ID: "assets", Label: "资产", Children: projectNodes},
	}
	return &thriftcanvasnode.SearchCanvasNodeAssetsResponse{
		Items:      items,
		NextCursor: optionalString(searchResult.NextCursor),
	}, nil
}

func canvasNodeMediaTypesFromDTO(values []thriftcanvasnode.CanvasNodeMediaType) ([]domaincanvasnode.MediaType, bool) {
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

func canvasnodeAssetMentionProjectDTO(item applicationcanvasnode.CanvasNodeAvailableAsset) *thriftcanvasnode.CanvasNodeAssetMentionNode {
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
		referenceType := thriftcanvasnode.CanvasNodeMentionReferenceType_RESOURCE
		result.ReferenceType = &referenceType
		resourceType := thriftresource.ResourceType(item.ResourceType)
		result.ResourceType = &resourceType
		result.Description = optionalString(item.Description)
		return result
	}
	return canvasnodeAssetMentionGroupDTO(item)
}

func canvasnodeAssetMentionGroupDTO(item applicationcanvasnode.CanvasNodeAvailableAsset) *thriftcanvasnode.CanvasNodeAssetMentionNode {
	children := make([]*thriftcanvasnode.CanvasNodeAssetMentionNode, 0, len(item.Assets))
	var previewURL *string
	resourceType := thriftresource.ResourceType(item.ResourceType)
	for _, child := range item.Assets {
		childDTO := canvasnodeAssetMentionLeafDTO(child, child.Name)
		childDTO.ResourceType = &resourceType
		children = append(children, childDTO)
		if child.Primary {
			previewURL = optionalString(child.PreviewURL)
		}
	}
	return &thriftcanvasnode.CanvasNodeAssetMentionNode{
		ID: item.ResourceID, Label: item.Name, Children: children,
		Description: optionalString(item.Description), URL: previewURL, ResourceType: &resourceType,
	}
}

func canvasnodeAssetMentionLeafDTO(child applicationcanvasnode.CanvasNodeAvailableAssetItem, label string) *thriftcanvasnode.CanvasNodeAssetMentionNode {
	mediaType := thriftasset.AssetMediaType(child.Asset.MediaType)
	referenceType := thriftcanvasnode.CanvasNodeMentionReferenceType_RESOURCE_ASSET
	available := child.Asset.ID != ""
	id := child.Asset.ID
	if id == "" {
		id = child.ResourceAssetID
	}
	result := &thriftcanvasnode.CanvasNodeAssetMentionNode{
		Available: &available, Generating: &child.Generating, AssetID: optionalString(child.Asset.ID),
		ID: id, Label: label, Children: make([]*thriftcanvasnode.CanvasNodeAssetMentionNode, 0),
		Description: optionalString(formatAssetSize(child.Asset.SizeBytes)), MediaType: &mediaType,
		URL: optionalString(child.PreviewURL), ResourceAssetID: optionalString(child.ResourceAssetID),
		ReferenceType: &referenceType, Reviews: assetReviewDTOs(child.Asset.Reviews),
	}
	return result
}

func canvasNodeMentionLeafDTO(item applicationcanvasnode.CanvasNodeMention) *thriftcanvasnode.CanvasNodeAssetMentionNode {
	nodeType := thriftcanvasnode.CanvasNodeType(item.Node.Type)
	referenceType := thriftcanvasnode.CanvasNodeMentionReferenceType_CANVAS_NODE
	result := &thriftcanvasnode.CanvasNodeAssetMentionNode{
		ID: item.Node.ID, CanvasNodeID: optionalString(item.Node.ID), NodeType: &nodeType,
		Label: item.Node.Name, Children: make([]*thriftcanvasnode.CanvasNodeAssetMentionNode, 0),
		URL: optionalString(item.PreviewURL), ResourceAssetID: optionalString(item.Node.ResourceAssetID), ReferenceType: &referenceType,
	}
	if result.Label == "" {
		result.Label = canvasNodeTypeLabel(item.Node.Type)
	}
	if item.Asset != nil {
		mediaType := thriftasset.AssetMediaType(item.Asset.MediaType)
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
	metadata, _ := requestcontext.MetadataFromContext(ctx)
	return applicationcanvasnode.Scope{TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(w), CallerID: metadata.UserID}
}
func configPatchFromDTO(v *thriftcanvasnode.CanvasNodeGenerationConfigPatch) domainvideo.ConfigPatch {
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
func generationConfigFromDTO(v *thriftcanvasnode.CanvasNodeGenerationConfig) domainvideo.Config {
	return domainvideo.Config{
		ModelServiceID: v.ModelServiceID, Resolution: domainvideo.Resolution(v.Resolution),
		AspectRatio: domainvideo.AspectRatio(v.AspectRatio), DurationSeconds: v.DurationSeconds,
		GenerateAudio: v.GenerateAudio, Watermark: v.Watermark,
	}
}
func generationConfigDTO(v domainvideo.Config) *thriftcanvasnode.CanvasNodeGenerationConfig {
	return &thriftcanvasnode.CanvasNodeGenerationConfig{
		ModelServiceID: v.ModelServiceID, Resolution: thriftcanvasnode.CanvasNodeResolution(v.Resolution),
		AspectRatio: thriftcanvasnode.CanvasNodeAspectRatio(v.AspectRatio), DurationSeconds: v.DurationSeconds,
		GenerateAudio: v.GenerateAudio, Watermark: v.Watermark,
	}
}
func canvasnodeDTO(v domaincanvasnode.CanvasNode, no int32) *thriftcanvasnode.CanvasNode {
	// ActiveTaskRunID directly exposes the node's current TaskRun for polling and cancellation.
	status := thriftcanvasnode.CanvasNodeStatus_EMPTY
	if v.ActiveTaskRunID != "" {
		status = thriftcanvasnode.CanvasNodeStatus_GENERATING
	} else if v.SelectedOutputID != "" || v.SelectedAssetID != "" || v.SelectedOutputText != "" || v.ResourceAssetID != "" || v.ResourceID != "" {
		status = thriftcanvasnode.CanvasNodeStatus_READY
	}
	var generationConfig *thriftcanvasnode.CanvasNodeGenerationConfig
	if v.Type == domaincanvasnode.NodeTypeVideoGeneration || v.Type == domaincanvasnode.NodeTypeImageGeneration || v.Type == domaincanvasnode.NodeTypeTextGeneration {
		generationConfig = generationConfigDTO(v.GenerationConfig)
	}
	edges := make([]*thriftcanvasnode.CanvasEdge, 0, len(v.IncomingEdges))
	for _, edge := range v.IncomingEdges {
		edges = append(edges, canvasEdgeDTO(edge))
	}
	return &thriftcanvasnode.CanvasNode{NodeID: v.ID, CanvasID: v.CanvasID, CanvasNodeNo: no, Prompt: v.Prompt,
		GenerationConfig: generationConfig, Status: status, SelectedOutputID: optionalCanvasNodeString(v.SelectedOutputID),
		SelectedAssetID: optionalCanvasNodeString(v.SelectedAssetID), ActiveTaskRunID: optionalCanvasNodeString(v.ActiveTaskRunID),
		FirstFrameAssetID: optionalCanvasNodeString(v.FirstFrameAssetID), FirstFrameURL: optionalCanvasNodeString(v.FirstFrameURL),
		LastFrameAssetID:  optionalCanvasNodeString(v.LastFrameAssetID),
		SelectedOutputURL: optionalCanvasNodeString(v.SelectedOutputURL), SelectedOutputDurationSeconds: v.SelectedOutputDurationSeconds,
		SelectedOutputText: optionalCanvasNodeString(v.SelectedOutputText),
		CreatedAt:          timestamp(v.CreatedAt), UpdatedAt: timestamp(v.UpdatedAt),
		CreatedBy: v.CreatedBy, UpdatedBy: v.UpdatedBy, Type: thriftcanvasnode.CanvasNodeType(v.Type), Name: v.Name,
		Position:       &thriftcanvasnode.CanvasNodePosition{PositionX: v.Position.PositionX, PositionY: v.Position.PositionY},
		StoryboardRank: optionalInt64(v.StoryboardRank), Text: optionalCanvasNodeString(v.Text), AssetID: optionalCanvasNodeString(v.AssetID),
		ResourceID: optionalCanvasNodeString(v.ResourceID), ResourceAssetID: optionalCanvasNodeString(v.ResourceAssetID),
		CurrentAssetID: optionalCanvasNodeString(v.CurrentAssetID), ResourceAssetRevision: optionalInt64(v.ResourceAssetRevision),
		ResourceAssetIsPrimary: optionalBool(v.ResourceAssetIsPrimary),
		ReferenceType:          canvasNodeReferenceTypeDTO(v.ReferenceType),
		ReferenceStatus:        canvasNodeReferenceStatusDTO(v.ReferenceStatus),
		VideoInputMode:         optionalVideoInputMode(v), IncomingEdges: edges, Revision: v.Revision}
}

func canvasnodeViewDTO(view applicationcanvasnode.CanvasNodeView, no int32, failure applicationcanvasgeneration.GenerationFailure) *thriftcanvasnode.CanvasNode {
	result := canvasnodeDTO(view.CanvasNode, no)
	if view.ActiveTaskRunID != "" {
		kind := thriftcanvasnode.CanvasNodeTaskType_GENERATION
		if view.AssetsMatching {
			kind = thriftcanvasnode.CanvasNodeTaskType_ASSETS_MATCH
			result.Status = thriftcanvasnode.CanvasNodeStatus_EMPTY
			if view.SelectedOutputID != "" || view.SelectedAssetID != "" || view.SelectedOutputText != "" || view.ResourceAssetID != "" || view.ResourceID != "" {
				result.Status = thriftcanvasnode.CanvasNodeStatus_READY
			}
		}
		result.ActiveTaskType = &kind
	}

	result.PreviewURL = optionalString(view.PreviewURL)
	result.Reviews = assetReviewDTOs(view.Reviews)
	if failure.TaskRunID != "" {
		result.LatestGenerationFailure = &thriftcanvasnode.CanvasNodeGenerationFailure{
			TaskRunID: failure.TaskRunID, ErrorCode: optionalString(failure.ErrorCode), ErrorMessage: optionalString(failure.ErrorMessage), SeedanceTaskID: optionalString(failure.SeedanceTaskID),
		}
	}
	return result
}

func canvasNodeReferenceStatusDTO(value domaincanvasnode.ReferenceStatus) thriftcanvasnode.CanvasNodeReferenceStatus {
	switch value {
	case domaincanvasnode.ReferenceStatusActive:
		return thriftcanvasnode.CanvasNodeReferenceStatus_ACTIVE
	case domaincanvasnode.ReferenceStatusDeleted:
		return thriftcanvasnode.CanvasNodeReferenceStatus_DELETED
	default:
		return thriftcanvasnode.CanvasNodeReferenceStatus_ACTIVE
	}
}

func canvasNodeReferenceTypeDTO(value domaincanvasnode.ReferenceType) *thriftcanvasnode.CanvasNodeMentionReferenceType {
	var result thriftcanvasnode.CanvasNodeMentionReferenceType
	switch value {
	case domaincanvasnode.ReferenceTypeAsset:
		result = thriftcanvasnode.CanvasNodeMentionReferenceType_ASSET
	case domaincanvasnode.ReferenceTypeResource:
		result = thriftcanvasnode.CanvasNodeMentionReferenceType_RESOURCE
	case domaincanvasnode.ReferenceTypeResourceAsset:
		result = thriftcanvasnode.CanvasNodeMentionReferenceType_RESOURCE_ASSET
	default:
		return nil
	}
	return &result
}

func optionalBool(value bool) *bool { return &value }

func canvasEdgeDTO(edge domaincanvasnode.IncomingEdge) *thriftcanvasnode.CanvasEdge {
	return &thriftcanvasnode.CanvasEdge{EdgeID: edge.ID, SourceNodeID: edge.SourceNodeID,
		SourcePort: thriftcanvasnode.CanvasPort_OUTPUT, TargetPort: portDTO(edge.TargetPort), TargetOrder: edge.TargetOrder}
}

func portDTO(port domaincanvasnode.Port) thriftcanvasnode.CanvasPort {
	switch port {
	case domaincanvasnode.PortReferenceImage:
		return thriftcanvasnode.CanvasPort_REFERENCE_IMAGE
	case domaincanvasnode.PortReferenceVideo:
		return thriftcanvasnode.CanvasPort_REFERENCE_VIDEO
	case domaincanvasnode.PortReferenceAudio:
		return thriftcanvasnode.CanvasPort_REFERENCE_AUDIO
	case domaincanvasnode.PortReferenceText:
		return thriftcanvasnode.CanvasPort_REFERENCE_TEXT
	case domaincanvasnode.PortFirstFrame:
		return thriftcanvasnode.CanvasPort_FIRST_FRAME
	case domaincanvasnode.PortLastFrame:
		return thriftcanvasnode.CanvasPort_LAST_FRAME
	default:
		return thriftcanvasnode.CanvasPort_OUTPUT
	}
}

func portFromDTO(port thriftcanvasnode.CanvasPort) (domaincanvasnode.Port, bool) {
	switch port {
	case thriftcanvasnode.CanvasPort_REFERENCE_IMAGE:
		return domaincanvasnode.PortReferenceImage, true
	case thriftcanvasnode.CanvasPort_REFERENCE_VIDEO:
		return domaincanvasnode.PortReferenceVideo, true
	case thriftcanvasnode.CanvasPort_REFERENCE_AUDIO:
		return domaincanvasnode.PortReferenceAudio, true
	case thriftcanvasnode.CanvasPort_REFERENCE_TEXT:
		return domaincanvasnode.PortReferenceText, true
	case thriftcanvasnode.CanvasPort_FIRST_FRAME:
		return domaincanvasnode.PortFirstFrame, true
	case thriftcanvasnode.CanvasPort_LAST_FRAME:
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

func mentionReferenceTypeFromDTO(value thriftcanvasnode.CanvasNodeMentionReferenceType) (applicationcanvasnode.MentionReferenceType, bool) {
	var result applicationcanvasnode.MentionReferenceType
	switch value {
	case thriftcanvasnode.CanvasNodeMentionReferenceType_ASSET:
		result = applicationcanvasnode.MentionReferenceTypeAsset
	case thriftcanvasnode.CanvasNodeMentionReferenceType_RESOURCE:
		result = applicationcanvasnode.MentionReferenceTypeResource
	case thriftcanvasnode.CanvasNodeMentionReferenceType_RESOURCE_ASSET:
		result = applicationcanvasnode.MentionReferenceTypeResourceAsset
	case thriftcanvasnode.CanvasNodeMentionReferenceType_CANVAS_NODE:
		result = applicationcanvasnode.MentionReferenceTypeCanvasNode
	default:
		return 0, false
	}
	return result, true
}

func optionalVideoInputMode(node domaincanvasnode.CanvasNode) *thriftcanvasnode.CanvasVideoInputMode {
	if node.Type != domaincanvasnode.NodeTypeVideoGeneration {
		return nil
	}
	value := thriftcanvasnode.CanvasVideoInputMode(node.VideoInputMode)
	return &value
}

func optionalCanvasNodeString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func historyDTO(run applicationvideogeneration.TaskRun) *thriftcanvasnode.CanvasNodeHistory {
	var completedAt *string
	if run.FinishedAt != nil {
		value := timestamp(*run.FinishedAt)
		completedAt = &value
	}
	resolution := thriftcanvasnode.CanvasNodeResolution(run.Resolution)
	aspectRatio := thriftcanvasnode.CanvasNodeAspectRatio(run.AspectRatio)
	durationSeconds := run.DurationSeconds
	generateAudio := run.GenerateAudio
	watermark := run.Watermark
	dto := &thriftcanvasnode.CanvasNodeHistory{
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
		Type:                   thriftcanvasnode.CanvasNodeType(run.NodeType),
		OutputAssetID:          optionalCanvasNodeString(run.OutputAssetID),
		OutputURL:              optionalCanvasNodeString(run.VideoURL),
		OutputText:             optionalCanvasNodeString(run.OutputText),
	}
	if run.NodeType == domaincanvasnode.NodeTypeVideoGeneration && run.ProviderStatus == domainvideo.ProviderStatusFailed {
		dto.SeedanceTaskID = optionalCanvasNodeString(run.SeedanceTaskID)
	}
	return dto
}

func resourceAssetSnapshotDTOs(items []domaingenerationinput.Input) []*thriftcanvasnode.CanvasNodeGenerationResourceAssetSnapshot {
	result := make([]*thriftcanvasnode.CanvasNodeGenerationResourceAssetSnapshot, 0, len(items))
	for _, item := range items {
		if item.ResourceAssetID == "" {
			continue
		}
		result = append(result, &thriftcanvasnode.CanvasNodeGenerationResourceAssetSnapshot{
			SourceNodeID: item.SourceNodeID, ResourceAssetID: item.ResourceAssetID,
			ResourceAssetRevision: item.ResourceAssetRevision, AssetID: item.AssetID,
		})
	}
	return result
}

func providerStatusDTO(status domainvideo.ProviderStatus) thriftcanvasnode.CanvasNodeVideoProviderStatus {
	statuses := map[domainvideo.ProviderStatus]thriftcanvasnode.CanvasNodeVideoProviderStatus{
		domainvideo.ProviderStatusPending:   thriftcanvasnode.CanvasNodeVideoProviderStatus_PENDING,
		domainvideo.ProviderStatusQueued:    thriftcanvasnode.CanvasNodeVideoProviderStatus_QUEUED,
		domainvideo.ProviderStatusRunning:   thriftcanvasnode.CanvasNodeVideoProviderStatus_RUNNING,
		domainvideo.ProviderStatusSucceeded: thriftcanvasnode.CanvasNodeVideoProviderStatus_SUCCEEDED,
		domainvideo.ProviderStatusFailed:    thriftcanvasnode.CanvasNodeVideoProviderStatus_FAILED,
		domainvideo.ProviderStatusCancelled: thriftcanvasnode.CanvasNodeVideoProviderStatus_CANCELLED,
		domainvideo.ProviderStatusUnknown:   thriftcanvasnode.CanvasNodeVideoProviderStatus_UNKNOWN,
	}
	if value, ok := statuses[status]; ok {
		return value
	}
	return thriftcanvasnode.CanvasNodeVideoProviderStatus_UNKNOWN
}

func generationStatusDTO(status string) thriftcanvasnode.CanvasGenerationStatus {
	statuses := map[string]thriftcanvasnode.CanvasGenerationStatus{
		arkmodel.StatusQueued:    thriftcanvasnode.CanvasGenerationStatus_QUEUED,
		arkmodel.StatusRunning:   thriftcanvasnode.CanvasGenerationStatus_RUNNING,
		arkmodel.StatusSucceeded: thriftcanvasnode.CanvasGenerationStatus_SUCCEEDED,
		arkmodel.StatusFailed:    thriftcanvasnode.CanvasGenerationStatus_FAILED,
		arkmodel.StatusCancelled: thriftcanvasnode.CanvasGenerationStatus_CANCELLED,
	}
	if value, ok := statuses[status]; ok {
		return value
	}
	return thriftcanvasnode.CanvasGenerationStatus_FAILED
}

func (h *CanvasNodeHandler) StartCanvasNodeAssetsMatch(ctx context.Context, r *thriftcanvasnode.StartCanvasNodeAssetsMatchRequest) (*thriftcanvasnode.StartCanvasNodeAssetsMatchResponse, error) {
	if err := requireAction(ctx, "StartCanvasNodeAssetsMatch"); err != nil {
		return nil, err
	}
	run, err := h.canvas_nodes.StartAssetsMatch(ctx, applicationcanvasnode.StartAssetsMatchInput{Scope: canvasnodeScope(ctx, r.WorkspaceID), ProjectID: r.ProjectID, CanvasID: r.CanvasID, NodeID: r.NodeID, Revision: r.Revision})
	if err != nil {
		return nil, err
	}
	return &thriftcanvasnode.StartCanvasNodeAssetsMatchResponse{TaskRunID: run.ID}, nil
}

func (h *CanvasNodeHandler) BatchGetCanvasNodeStates(ctx context.Context, r *thriftcanvasnode.BatchGetCanvasNodeStatesRequest) (*thriftcanvasnode.BatchGetCanvasNodeStatesResponse, error) {
	if err := requireAction(ctx, "BatchGetCanvasNodeStates"); err != nil {
		return nil, err
	}
	scope := canvasnodeScope(ctx, r.WorkspaceID)
	targets := make([]applicationcanvasgeneration.GenerationTarget, 0, len(r.Targets))
	for _, target := range r.Targets {
		if target == nil {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		targets = append(targets, applicationcanvasgeneration.GenerationTarget{NodeID: target.NodeID, TaskRunID: target.TaskRunID})
	}
	states := make([]applicationcanvasgeneration.GenerationState, 0, len(targets))
	if len(targets) > 0 {
		var err error
		states, err = h.generations.BatchGetStates(ctx, scope, r.ProjectID, r.CanvasID, targets)
		if err != nil {
			return nil, err
		}
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
	byID := make(map[string]*thriftcanvasnode.CanvasNode, len(views))
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
	items := make([]*thriftcanvasnode.CanvasNodeState, 0, len(states))
	for _, state := range states {
		node := byID[state.Node.ID]
		if node == nil {
			continue
		}
		item := &thriftcanvasnode.CanvasNodeState{NodeID: node.NodeID, TaskRunID: state.Run.ID, Status: generationStatusDTO(string(state.Run.Status)), TaskType: thriftcanvasnode.CanvasNodeTaskType_GENERATION, Node: node, RelatedNodes: []*thriftcanvasnode.CanvasNode{}, ErrorCode: optionalString(state.Run.ErrorCode), ErrorMessage: optionalString(state.Run.ErrorMessage), SeedanceTaskID: optionalString(state.SeedanceTaskID)}
		if state.Run.RunType == domaintask.RunTypeCanvasNodeAssetsMatch {
			item.TaskType = thriftcanvasnode.CanvasNodeTaskType_ASSETS_MATCH
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
			if item.TaskType == thriftcanvasnode.CanvasNodeTaskType_GENERATION {
				node.Status = thriftcanvasnode.CanvasNodeStatus_GENERATING
			}
		}
		if state.VideoProviderStatus != nil {
			status := providerStatusDTO(*state.VideoProviderStatus)
			item.VideoProviderStatus = &status
		}
		items = append(items, item)
	}
	requestedNodes := make([]*thriftcanvasnode.CanvasNode, 0, len(items))
	for _, item := range items {
		requestedNodes = append(requestedNodes, item.Node)
	}
	if err = h.attachStoryboardDraftSessions(ctx, scope, r.ProjectID, r.CanvasID, requestedNodes); err != nil {
		return nil, err
	}
	return &thriftcanvasnode.BatchGetCanvasNodeStatesResponse{Items: items}, nil
}

func (h *CanvasNodeHandler) CancelCanvasNodeAssetsMatch(ctx context.Context, r *thriftcanvasnode.CancelCanvasNodeAssetsMatchRequest) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "CancelCanvasNodeAssetsMatch"); err != nil {
		return nil, err
	}
	if err := h.canvas_nodes.CancelAssetsMatch(ctx, canvasnodeScope(ctx, r.WorkspaceID), r.ProjectID, r.CanvasID, r.NodeID, r.TaskRunID); err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
}
