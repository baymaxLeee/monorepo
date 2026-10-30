package canvasgeneration

import (
	"context"
	"errors"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcanvasimagegeneration "github.com/example/monorepo/canvas/internal/application/canvasimagegeneration"
	applicationtextgeneration "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type NodeReader interface {
	Get(context.Context, applicationcanvas.Scope, string, string, string) (domaincanvas.CanvasNode, error)
	SelectGeneratedAsset(context.Context, applicationcanvas.Scope, string, string, string, string, string, domaincanvas.NodeType, time.Time) (bool, error)
}

type GenerationFailure struct {
	TaskRunID, ErrorCode, ErrorMessage, SeedanceTaskID string
}

type ImageEngine interface {
	Start(context.Context, applicationimagegeneration.StartInput) (domainimagegeneration.Run, error)
	GetRun(context.Context, applicationimagegeneration.GetRunInput) (applicationimagegeneration.RunView, error)
	ListRuns(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, string) ([]applicationimagegeneration.RunView, error)
	Cancel(context.Context, applicationimagegeneration.CancelInput) error
}

type AssetPreviewer interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type ImageModelCatalog interface {
	Resolve(context.Context, applicationmodel.Actor, []applicationmodel.Requirement) ([]applicationmodel.Resolution, error)
}

type Service struct {
	nodes  NodeReader
	images ImageEngine
	videos *applicationvideogeneration.Service
	texts  *applicationtextgeneration.Service
	assets AssetPreviewer
	models ImageModelCatalog
}

type ServiceOption func(*Service)

func WithImageModelCatalog(models ImageModelCatalog) ServiceOption {
	return func(service *Service) {
		service.models = models
	}
}

func NewService(nodes NodeReader, images ImageEngine, videos *applicationvideogeneration.Service, texts *applicationtextgeneration.Service, assets AssetPreviewer, options ...ServiceOption) *Service {
	service := &Service{
		nodes: nodes, images: images, videos: videos, texts: texts, assets: assets,
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Start(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) (string, error) {
	node, err := s.node(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return "", err
	}
	switch node.Type {
	case domaincanvas.NodeTypeVideoGeneration:
		return s.videos.Start(ctx, scope, projectID, canvasID, nodeID)
	case domaincanvas.NodeTypeImageGeneration:
		resolved, resolveErr := s.resolveImageUsageSnapshot(ctx, scope, node)
		if resolveErr != nil {
			return "", resolveErr
		}
		run, startErr := s.images.Start(ctx, applicationimagegeneration.StartInput{
			Scope: imageScope(scope), TargetType: domainimagegeneration.TargetCanvasNode,
			TargetID: node.ID, ExpectedRevision: node.Revision,
			ProjectID: projectID, ModelName: resolved.ModelName, ModelSource: string(resolved.ModelSource),
		})
		if startErr != nil {
			return "", classify(startErr)
		}
		return run.TaskRunID, nil
	default:
		return "", errno.New(errno.ErrInvalidArgument)
	}
}

func (s *Service) resolveImageUsageSnapshot(
	ctx context.Context,
	scope applicationcanvas.Scope,
	node domaincanvas.CanvasNode,
) (applicationmodel.Resolution, error) {
	if s.models == nil {
		return applicationmodel.Resolution{}, errno.New(errno.ErrConfigurationError)
	}
	capability := applicationmodel.CapabilityResourceTextToImage
	for _, edge := range node.IncomingEdges {
		if edge.TargetPort == domaincanvas.PortReferenceImage {
			capability = applicationmodel.CapabilityResourceImageToImage
			break
		}
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		UserID: scope.CallerID,
	}, []applicationmodel.Requirement{{
		Capability: capability,
		ModelID:    node.GenerationConfig.ModelServiceID,
	}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return applicationmodel.Resolution{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return applicationmodel.Resolution{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return applicationmodel.Resolution{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 ||
		strings.TrimSpace(resolved[0].Selection.ModelID) != strings.TrimSpace(node.GenerationConfig.ModelServiceID) ||
		strings.TrimSpace(resolved[0].ModelName) == "" || strings.TrimSpace(string(resolved[0].ModelSource)) == "" {
		return applicationmodel.Resolution{}, errno.New(errno.ErrModelDependencyError)
	}
	return resolved[0], nil
}

func (s *Service) Cancel(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID string) error {
	node, err := s.node(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return err
	}
	if node.Type == domaincanvas.NodeTypeVideoGeneration {
		return s.videos.Cancel(ctx, scope, projectID, canvasID, nodeID, taskRunID)
	}
	if node.Type == domaincanvas.NodeTypeTextGeneration {
		return s.texts.Cancel(ctx, scope, projectID, canvasID, nodeID, taskRunID)
	}
	if node.Type != domaincanvas.NodeTypeImageGeneration {
		return errno.New(errno.ErrInvalidArgument)
	}
	return classify(s.images.Cancel(ctx, applicationimagegeneration.CancelInput{Scope: imageScope(scope), TargetType: domainimagegeneration.TargetCanvasNode, TargetID: nodeID, TaskRunID: taskRunID}))
}

func (s *Service) CancelActive(ctx context.Context, scope applicationcanvas.Scope, node domaincanvas.CanvasNode) error {
	if strings.TrimSpace(node.ActiveTaskRunID) == "" {
		return nil
	}
	switch node.Type {
	case domaincanvas.NodeTypeVideoGeneration:
		return s.videos.CancelActive(ctx, scope, node)
	case domaincanvas.NodeTypeImageGeneration:
		return classify(s.images.Cancel(ctx, applicationimagegeneration.CancelInput{Scope: imageScope(scope), TargetType: domainimagegeneration.TargetCanvasNode, TargetID: node.ID, TaskRunID: node.ActiveTaskRunID}))
	case domaincanvas.NodeTypeTextGeneration:
		return s.texts.Cancel(ctx, scope, node.ProjectID, node.CanvasID, node.ID, node.ActiveTaskRunID)
	default:
		return nil
	}
}

func (s *Service) StartCanvas(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string) ([]applicationvideogeneration.CanvasStart, int, error) {
	return s.videos.StartCanvas(ctx, scope, projectID, canvasID)
}
func (s *Service) List(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) ([]applicationvideogeneration.TaskRun, error) {
	node, err := s.node(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return nil, err
	}
	switch node.Type {
	case domaincanvas.NodeTypeVideoGeneration:
		return s.videos.List(ctx, scope, projectID, canvasID, nodeID)
	case domaincanvas.NodeTypeImageGeneration:
		views, listErr := s.images.ListRuns(ctx, imageScope(scope), domainimagegeneration.TargetCanvasNode, nodeID)
		if listErr != nil {
			return nil, classify(listErr)
		}
		result := make([]applicationvideogeneration.TaskRun, 0, len(views))
		references := make([]applicationasset.AssetReference, 0, len(views))
		for _, view := range views {
			item := imageRun(view, node)
			result = append(result, item)
			if item.OutputAssetID != "" {
				references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerImageGenerationOutput, Key: item.TaskRunID}, AssetID: item.OutputAssetID})
			}
		}
		urls, previewErr := s.previewURLs(ctx, scope, references)
		if previewErr != nil {
			return nil, previewErr
		}
		for index := range result {
			result[index].VideoURL = urls[result[index].OutputAssetID]
		}
		return result, nil
	case domaincanvas.NodeTypeTextGeneration:
		sessions, listErr := s.texts.List(ctx, scope, projectID, canvasID, nodeID)
		if listErr != nil {
			return nil, listErr
		}
		result := make([]applicationvideogeneration.TaskRun, 0, len(sessions))
		for _, session := range sessions {
			result = append(result, textRun(session))
		}
		return result, nil
	default:
		return nil, errno.New(errno.ErrInvalidArgument)
	}
}
func (s *Service) Select(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, historyID string) (applicationvideogeneration.TaskRun, error) {
	node, err := s.node(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return applicationvideogeneration.TaskRun{}, err
	}
	switch node.Type {
	case domaincanvas.NodeTypeVideoGeneration:
		return s.videos.Select(ctx, scope, projectID, canvasID, nodeID, historyID)
	case domaincanvas.NodeTypeImageGeneration:
		view, getErr := s.images.GetRun(ctx, applicationimagegeneration.GetRunInput{Scope: imageScope(scope), TargetType: domainimagegeneration.TargetCanvasNode, TargetID: nodeID, TaskRunID: historyID})
		if getErr != nil {
			return applicationvideogeneration.TaskRun{}, classify(getErr)
		}
		item := imageRun(view, node)
		if item.Status != string(domaintask.StatusSucceeded) || item.OutputAssetID == "" {
			return applicationvideogeneration.TaskRun{}, errno.NewWithMessage(errno.ErrFailedPrecondition, "只能选用已成功生成的图片")
		}
		selected, selectErr := s.nodes.SelectGeneratedAsset(ctx, scope, projectID, canvasID, nodeID, historyID, item.OutputAssetID, domaincanvas.NodeTypeImageGeneration, time.Now().UTC())
		if selectErr != nil {
			return applicationvideogeneration.TaskRun{}, classify(selectErr)
		}
		if !selected {
			return applicationvideogeneration.TaskRun{}, errno.New(errno.ErrConflict)
		}
		urls, previewErr := s.previewURLs(ctx, scope, []applicationasset.AssetReference{{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerImageGenerationOutput, Key: item.TaskRunID}, AssetID: item.OutputAssetID}})
		if previewErr != nil {
			return applicationvideogeneration.TaskRun{}, previewErr
		}
		item.VideoURL = urls[item.OutputAssetID]
		return item, nil
	case domaincanvas.NodeTypeTextGeneration:
		session, selectErr := s.texts.Select(ctx, scope, projectID, canvasID, nodeID, historyID)
		if selectErr != nil {
			return applicationvideogeneration.TaskRun{}, selectErr
		}
		return textRun(session), nil
	default:
		return applicationvideogeneration.TaskRun{}, errno.New(errno.ErrInvalidArgument)
	}
}

func (s *Service) node(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) (domaincanvas.CanvasNode, error) {
	if s == nil || s.nodes == nil || s.images == nil || s.videos == nil || s.texts == nil || s.assets == nil || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(nodeID) == "" {
		return domaincanvas.CanvasNode{}, errno.New(errno.ErrInvalidArgument)
	}
	node, err := s.nodes.Get(ctx, scope, projectID, canvasID, nodeID)
	if err != nil {
		return domaincanvas.CanvasNode{}, classify(err)
	}
	return node, nil
}

func (s *Service) previewURLs(ctx context.Context, scope applicationcanvas.Scope, references []applicationasset.AssetReference) (map[string]string, error) {
	result := make(map[string]string, len(references))
	if len(references) == 0 {
		return result, nil
	}
	items, err := s.assets.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{Scope: applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, References: references})
	if err != nil {
		return nil, errno.Wrap(errno.ErrPersistenceError, err)
	}
	for _, item := range items {
		if item.ErrorCode != "" || item.URL == "" {
			return nil, errno.New(errno.ErrPersistenceError)
		}
		result[item.Reference.AssetID] = item.URL
	}
	return result, nil
}

func imageScope(scope applicationcanvas.Scope) applicationimagegeneration.Scope {
	return applicationimagegeneration.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}
}

func imageRun(view applicationimagegeneration.RunView, node domaincanvas.CanvasNode) applicationvideogeneration.TaskRun {
	provider := domainvideo.ProviderStatusPending
	if view.TaskRun.Status == domaintask.StatusRunning {
		provider = domainvideo.ProviderStatusRunning
	}
	if view.TaskRun.Status == domaintask.StatusSucceeded {
		provider = domainvideo.ProviderStatusSucceeded
	}
	if view.TaskRun.Status == domaintask.StatusFailed {
		provider = domainvideo.ProviderStatusFailed
	}
	if view.TaskRun.Status == domaintask.StatusCancelled {
		provider = domainvideo.ProviderStatusCancelled
	}
	return applicationvideogeneration.TaskRun{TaskRunID: view.TaskRun.ID, TenantID: view.TaskRun.TenantID, WorkspaceID: view.TaskRun.WorkspaceID, ProjectID: node.ProjectID, CanvasID: node.CanvasID, NodeID: node.ID, CallerID: view.TaskRun.CreatedBy, Status: string(view.TaskRun.Status), ErrorCode: view.TaskRun.ErrorCode, ErrorMessage: view.TaskRun.ErrorMessage, ProviderStatus: provider, NodeType: domaincanvas.NodeTypeImageGeneration, OutputAssetID: view.Detail.OutputAssetID, ModelServiceID: view.Detail.Config.ModelID, Prompt: view.Detail.Config.Prompt, Inputs: view.Detail.InputSnapshots, Resolution: imageResolutionHistory(view.Detail.Config.Resolution), AspectRatio: imageAspectRatioHistory(view.Detail.Config.AspectRatio), Watermark: view.Detail.Config.Watermark, CreatedAt: view.TaskRun.CreatedAt, UpdatedAt: view.TaskRun.UpdatedAt, FinishedAt: view.TaskRun.FinishedAt}
}

func textRun(session applicationtextgeneration.Session) applicationvideogeneration.TaskRun {
	item := applicationvideogeneration.TaskRun{
		TaskRunID: session.ID, ProjectID: session.ProjectID, CanvasID: session.CanvasID, NodeID: session.NodeID,
		Status: string(session.Status), NodeType: domaincanvas.NodeTypeTextGeneration, ModelServiceID: session.ModelServiceID,
		Prompt: session.Prompt, OutputText: session.Content, Inputs: session.Inputs,
		CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt, FinishedAt: session.FinishedAt,
	}
	switch session.Status {
	case domaintask.StatusRunning:
		item.ProviderStatus = domainvideo.ProviderStatusRunning
	case domaintask.StatusSucceeded:
		item.ProviderStatus = domainvideo.ProviderStatusSucceeded
	case domaintask.StatusFailed:
		item.ProviderStatus = domainvideo.ProviderStatusFailed
	case domaintask.StatusCancelled:
		item.ProviderStatus = domainvideo.ProviderStatusCancelled
	default:
		item.ProviderStatus = domainvideo.ProviderStatusPending
	}
	if session.Failure != nil {
		item.ErrorCode = session.Failure.Code
		item.ErrorMessage = session.Failure.Message
	}
	return item
}

func imageResolutionHistory(value domainimagegeneration.Resolution) domainvideo.Resolution {
	switch value {
	case domainimagegeneration.Resolution480P:
		return domainvideo.Resolution480
	case domainimagegeneration.Resolution1080P:
		return domainvideo.Resolution1080
	case domainimagegeneration.Resolution4K:
		return domainvideo.Resolution4K
	default:
		return domainvideo.Resolution720
	}
}

func imageAspectRatioHistory(value domainimagegeneration.AspectRatio) domainvideo.AspectRatio {
	for _, candidate := range []domainvideo.AspectRatio{domainvideo.Aspect21x9, domainvideo.Aspect16x9, domainvideo.Aspect4x3, domainvideo.Aspect1x1, domainvideo.Aspect3x4, domainvideo.Aspect9x16, domainvideo.Aspect3x2, domainvideo.Aspect2x3} {
		if candidate.ProviderValue() == string(value) {
			return candidate
		}
	}
	return domainvideo.Aspect9x16
}

func classify(err error) error {
	if err == nil {
		return nil
	}
	var businessError *errno.BizError
	if errors.As(err, &businessError) {
		return err
	}
	switch {
	case errors.Is(err, applicationquota.ErrExceeded):
		return errno.Wrap(errno.ErrStorageQuotaExceeded, err)
	case errors.Is(err, applicationquota.ErrUnavailable):
		return errno.Wrap(errno.ErrQuotaUnavailable, err)
	case errors.Is(err, applicationimagegeneration.ErrNotFound), errors.Is(err, applicationtask.ErrNotFound):
		return errno.Wrap(errno.ErrNotFound, err)
	case errors.Is(err, applicationcanvasimagegeneration.ErrModelUnavailable):
		return errno.Wrap(errno.ErrModelUnavailable, err)
	case errors.Is(err, applicationcanvasimagegeneration.ErrNodeNotReady):
		return errno.Wrap(errno.ErrFailedPrecondition, err)
	case errors.Is(err, applicationimagegeneration.ErrRunConflict), errors.Is(err, applicationcanvasimagegeneration.ErrRunConflict):
		return errno.Wrap(errno.ErrConflict, err)
	case errors.Is(err, domainimagegeneration.ErrInvalidGeneration):
		return errno.Wrap(errno.ErrInvalidArgument, err)
	}
	return errno.Wrap(errno.ErrInternalError, err)
}
