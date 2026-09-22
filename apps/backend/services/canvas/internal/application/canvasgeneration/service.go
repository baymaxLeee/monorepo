package canvasgeneration

import (
	"context"
	"errors"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationcanvasimagegeneration "github.com/example/monorepo/canvas/internal/application/canvasimagegeneration"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
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

type GenerationNodeBatchReader interface {
	BatchGet(context.Context, applicationcanvas.Scope, string, string, []string) ([]domaincanvas.CanvasNode, error)
}

type VideoFrameTaskBatchReader interface {
	BatchGetProviderStatuses(context.Context, applicationcanvas.Scope, []string) (map[string]domainvideo.ProviderStatus, error)
	BatchGetFailedProviderFacts(context.Context, applicationcanvas.Scope, []string) (map[string]applicationvideogeneration.FailedProviderFacts, error)
}

type GenerationRunBatchReader interface {
	applicationtask.TaskRunBatchReader
	applicationtask.ScopedTaskRunBatchReader
	applicationtask.LatestTaskRunBatchReader
}

type GenerationTarget struct {
	NodeID, TaskRunID string
}

type GenerationState struct {
	VideoProviderStatus *domainvideo.ProviderStatus
	Node                domaincanvas.CanvasNode
	Run                 domaintask.TaskRun
	SeedanceTaskID      string
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
	nodes           NodeReader
	images          ImageEngine
	videos          *applicationvideogeneration.Service
	assets          AssetPreviewer
	models          ImageModelCatalog
	generationNodes GenerationNodeBatchReader
	generationRuns  GenerationRunBatchReader
	videoFrameTasks VideoFrameTaskBatchReader
}

type ServiceOption func(*Service)

func WithImageModelCatalog(models ImageModelCatalog) ServiceOption {
	return func(service *Service) {
		service.models = models
	}
}

func WithGenerationStateReaders(
	nodes GenerationNodeBatchReader,
	runs GenerationRunBatchReader,
	videoFrameTasks VideoFrameTaskBatchReader,
) ServiceOption {
	return func(service *Service) {
		service.generationNodes = nodes
		service.generationRuns = runs
		service.videoFrameTasks = videoFrameTasks
	}
}

func NewService(nodes NodeReader, images ImageEngine, videos *applicationvideogeneration.Service, assets AssetPreviewer, options ...ServiceOption) *Service {
	service := &Service{
		nodes: nodes, images: images, videos: videos, assets: assets,
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

func (s *Service) BatchGetStates(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string, targets []GenerationTarget) ([]GenerationState, error) {
	if s == nil || s.generationNodes == nil || s.generationRuns == nil || s.videoFrameTasks == nil || strings.TrimSpace(scope.TenantID) == "" ||
		strings.TrimSpace(scope.CallerID) == "" || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		len(targets) == 0 || len(targets) > 100 {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	unique := make([]GenerationTarget, 0, len(targets))
	nodeIDs := make([]string, 0, len(targets))
	taskRunIDs := make([]string, 0, len(targets))
	seen := make(map[string]struct{}, len(targets))
	seenNodes := make(map[string]struct{}, len(targets))
	seenTaskRuns := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		nodeID := strings.TrimSpace(target.NodeID)
		taskRunID := strings.TrimSpace(target.TaskRunID)
		if nodeID == "" || taskRunID == "" {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		key := nodeID + "\x00" + taskRunID
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, GenerationTarget{NodeID: nodeID, TaskRunID: taskRunID})
		if _, exists := seenNodes[nodeID]; !exists {
			seenNodes[nodeID] = struct{}{}
			nodeIDs = append(nodeIDs, nodeID)
		}
		if _, exists := seenTaskRuns[taskRunID]; !exists {
			seenTaskRuns[taskRunID] = struct{}{}
			taskRunIDs = append(taskRunIDs, taskRunID)
		}
	}
	runs, err := s.generationRuns.BatchGetTaskRuns(ctx, applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}, taskRunIDs)
	if err != nil {
		return nil, classify(err)
	}
	nodes, err := s.generationNodes.BatchGet(ctx, scope, projectID, canvasID, nodeIDs)
	if err != nil {
		return nil, classify(err)
	}
	videoTaskRunIDs := make([]string, 0, len(runs))
	failedVideoTaskRunIDs := make([]string, 0, len(runs))
	for _, run := range runs {
		if run.RunType == domaintask.RunTypeCanvasNodeVideoGeneration {
			videoTaskRunIDs = append(videoTaskRunIDs, run.ID)
		}
		if run.RunType == domaintask.RunTypeCanvasNodeVideoGeneration && run.Status == domaintask.StatusFailed {
			failedVideoTaskRunIDs = append(failedVideoTaskRunIDs, run.ID)
		}
	}
	failedProviderFacts := make(map[string]applicationvideogeneration.FailedProviderFacts, len(failedVideoTaskRunIDs))
	if len(failedVideoTaskRunIDs) > 0 {
		failedProviderFacts, err = s.videoFrameTasks.BatchGetFailedProviderFacts(ctx, scope, failedVideoTaskRunIDs)
		if err != nil {
			return nil, classify(err)
		}
	}
	providerStatuses := map[string]domainvideo.ProviderStatus{}
	if len(videoTaskRunIDs) > 0 {
		providerStatuses, err = s.videoFrameTasks.BatchGetProviderStatuses(ctx, scope, videoTaskRunIDs)
		if err != nil {
			return nil, classify(err)
		}
	}
	nodesByID := make(map[string]domaincanvas.CanvasNode, len(nodes))
	for _, node := range nodes {
		nodesByID[node.ID] = node
	}
	runsByID := make(map[string]domaintask.TaskRun, len(runs))
	for _, run := range runs {
		runsByID[run.ID] = run
	}
	references := make([]applicationasset.AssetReference, 0, len(nodes)*2)
	for _, node := range nodes {
		if node.SelectedAssetID != "" && node.SelectedOutputID != "" {
			ownerType := applicationasset.ReferenceOwnerVideoGenerationOutput
			if node.Type == domaincanvas.NodeTypeImageGeneration {
				ownerType = applicationasset.ReferenceOwnerImageGenerationOutput
			}
			references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: ownerType, Key: node.SelectedOutputID}, AssetID: node.SelectedAssetID})
		}
		if node.FirstFrameAssetID != "" && node.SelectedOutputID != "" {
			references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: node.SelectedOutputID}, AssetID: node.FirstFrameAssetID})
		}
	}
	urls, err := s.previewURLs(ctx, scope, references)
	if err != nil {
		return nil, err
	}
	items := make([]GenerationState, 0, len(unique))
	for _, target := range unique {
		node, nodeFound := nodesByID[target.NodeID]
		run, runFound := runsByID[target.TaskRunID]
		if !nodeFound || !runFound || run.SubjectID != node.ID || !generationRunMatchesNode(run.RunType, node.Type) {
			continue
		}
		node.SelectedOutputURL = urls[node.SelectedAssetID]
		node.FirstFrameURL = urls[node.FirstFrameAssetID]
		state := GenerationState{Node: node, Run: run, SeedanceTaskID: failedProviderFacts[run.ID].SeedanceTaskID}
		if run.RunType == domaintask.RunTypeCanvasNodeVideoGeneration {
			status, found := providerStatuses[run.ID]
			if !found {
				status = domainvideo.ProviderStatusUnknown
			}
			state.VideoProviderStatus = &status
		}
		items = append(items, state)
	}
	return items, nil
}

func (s *Service) BatchGetLatestFailures(ctx context.Context, scope applicationcanvas.Scope, nodes []domaincanvas.CanvasNode) (map[string]GenerationFailure, error) {
	if s == nil || s.generationRuns == nil || s.videoFrameTasks == nil || strings.TrimSpace(scope.TenantID) == "" || strings.TrimSpace(scope.CallerID) == "" {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	subjects := make([]applicationtask.TaskRunSubject, 0, len(nodes))
	for _, node := range nodes {
		var subject applicationtask.TaskRunSubject
		subject.SubjectID = node.ID
		switch node.Type {
		case domaincanvas.NodeTypeImageGeneration:
			subject.RunType = domaintask.RunTypeImageGeneration
			subject.SubjectType = domaintask.SubjectTypeImageGeneration
		case domaincanvas.NodeTypeVideoGeneration:
			subject.RunType = domaintask.RunTypeCanvasNodeVideoGeneration
			subject.SubjectType = domaintask.SubjectTypeCanvasNode
		default:
			continue
		}
		subjects = append(subjects, subject)
	}
	result := make(map[string]GenerationFailure)
	for start := 0; start < len(subjects); start += 100 {
		end := min(start+100, len(subjects))
		runs, err := s.generationRuns.BatchGetLatestTaskRunsBySubjects(
			ctx,
			applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID},
			subjects[start:end],
		)
		if err != nil {
			return nil, classify(err)
		}
		failedVideoRunIDs := make([]string, 0, len(runs))
		for _, run := range runs {
			if run.Status != domaintask.StatusFailed {
				continue
			}
			result[run.SubjectID] = GenerationFailure{TaskRunID: run.ID, ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage}
			if run.RunType == domaintask.RunTypeCanvasNodeVideoGeneration {
				failedVideoRunIDs = append(failedVideoRunIDs, run.ID)
			}
		}
		if len(failedVideoRunIDs) == 0 {
			continue
		}
		failedProviderFacts, err := s.videoFrameTasks.BatchGetFailedProviderFacts(ctx, scope, failedVideoRunIDs)
		if err != nil {
			return nil, classify(err)
		}
		for nodeID, failure := range result {
			if facts, ok := failedProviderFacts[failure.TaskRunID]; ok {
				if failure.ErrorCode == "" {
					failure.ErrorCode = facts.ErrorCode
				}
				failure.SeedanceTaskID = facts.SeedanceTaskID
				result[nodeID] = failure
			}
		}
	}
	return result, nil
}

func generationRunMatchesNode(runType domaintask.RunType, nodeType domaincanvas.NodeType) bool {
	if runType == domaintask.RunTypeCanvasNodeAssetsMatch {
		return nodeType == domaincanvas.NodeTypeImageGeneration || nodeType == domaincanvas.NodeTypeVideoGeneration
	}
	switch nodeType {
	case domaincanvas.NodeTypeImageGeneration:
		return runType == domaintask.RunTypeImageGeneration
	case domaincanvas.NodeTypeVideoGeneration:
		return runType == domaintask.RunTypeCanvasNodeVideoGeneration
	default:
		return false
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
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
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
	default:
		return applicationvideogeneration.TaskRun{}, errno.New(errno.ErrInvalidArgument)
	}
}

func (s *Service) node(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) (domaincanvas.CanvasNode, error) {
	if s == nil || s.nodes == nil || s.images == nil || s.videos == nil || s.assets == nil || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(nodeID) == "" {
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
