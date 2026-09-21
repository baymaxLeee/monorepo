package canvas

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
	applicationmodel "github.com/example/monorepo/canvas/internal/server/application/model"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	domainvideo "github.com/example/monorepo/canvas/internal/server/domain/videogeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type Draft struct {
	ID              string
	CanvasNodeNo    int
	Prompt          string
	DurationSeconds int32
	AssetReferences []StoryboardAssetReference `json:"asset_references,omitempty"`
}

type CanvasNodeDraftConfirmInput struct {
	Prompt           string
	GenerationConfig domainvideo.Config
	AssetReferences  []StoryboardAssetReference
}

type storyboardAssetSnapshot struct {
	once       sync.Once
	load       func(context.Context) ([]ProjectAssetCandidate, error)
	items      []ProjectAssetCandidate
	candidates []StoryboardAssetCandidate
	err        error
}

func (s *storyboardAssetSnapshot) Load(ctx context.Context) ([]StoryboardAssetCandidate, error) {
	if s == nil || s.load == nil {
		return nil, nil
	}
	s.once.Do(func() {
		s.items, s.err = s.load(ctx)
		if s.err != nil {
			return
		}
		s.candidates = make([]StoryboardAssetCandidate, 0, len(s.items))
		for _, item := range s.items {
			s.candidates = append(s.candidates, StoryboardAssetCandidate{
				ResourceAssetID: item.ResourceAssetID, Name: item.Name, MediaType: item.Asset.MediaType,
				ResourceID: item.ResourceID, ResourceName: item.ResourceName,
				Description: item.Description, Primary: item.Primary,
			})
		}
	})
	return append([]StoryboardAssetCandidate(nil), s.candidates...), s.err
}

func (s *storyboardAssetSnapshot) ProjectCandidates(ctx context.Context) ([]ProjectAssetCandidate, error) {
	if s == nil {
		return nil, nil
	}
	if _, err := s.Load(ctx); err != nil {
		return nil, err
	}
	return append([]ProjectAssetCandidate(nil), s.items...), nil
}

const (
	storyboardPlanningDurationMinSeconds = 4
	storyboardPlanningDurationMaxSeconds = 30
	storyboardTotalDurationMinSeconds    = 60
	storyboardTotalDurationMaxSeconds    = 50 * 60
)

func (s *CanvasNodeService) PrepareStoryboardPlanning(
	ctx context.Context,
	scope Scope,
	modelConfig StoryboardModelConfig,
	planning StoryboardPlanningConfig,
	_ int,
) (StoryboardModelConfig, StoryboardPlanningConfig, StoryboardInferenceModelSnapshot, error) {
	if !validCallerScope(scope) || s.models == nil || !modelConfig.VideoParameters.Valid() {
		return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, errno.New(errno.ErrInvalidArgument)
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
	}, []applicationmodel.Requirement{
		{
			Capability: applicationmodel.CapabilityStoryboardInference,
			ModelID:    modelConfig.InferenceModelServiceID,
		},
		{
			Capability: applicationmodel.CapabilityCanvasNodeVideo,
			ModelID:    modelConfig.VideoModelServiceID,
		},
	})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 2 || strings.TrimSpace(resolved[0].Selection.ModelID) == "" ||
		strings.TrimSpace(resolved[0].ModelName) == "" || strings.TrimSpace(string(resolved[0].ModelSource)) == "" ||
		strings.TrimSpace(resolved[1].Selection.ModelID) == "" || resolved[1].VideoCapabilities == nil {
		return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, errno.New(errno.ErrModelDependencyError)
	}
	modelConfig.InferenceModelServiceID = strings.TrimSpace(resolved[0].Selection.ModelID)
	inferenceSnapshot := StoryboardInferenceModelSnapshot{
		ModelID: modelConfig.InferenceModelServiceID, ModelName: strings.TrimSpace(resolved[0].ModelName),
		ModelSource: strings.TrimSpace(string(resolved[0].ModelSource)),
	}
	modelConfig.VideoModelServiceID = strings.TrimSpace(resolved[1].Selection.ModelID)
	capabilities := *resolved[1].VideoCapabilities
	if capabilities.DurationMinSeconds < 1 || capabilities.DurationMaxSeconds < capabilities.DurationMinSeconds {
		return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, errno.New(errno.ErrModelDependencyError)
	}
	planning = normalizeStoryboardPlanningConfigForVideo(planning, capabilities)
	if err = validateStoryboardPlanningForVideo(planning, capabilities); err != nil {
		return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, err
	}
	if err = validateStoryboardVideoParameters(modelConfig.VideoParameters, planning, capabilities); err != nil {
		return StoryboardModelConfig{}, StoryboardPlanningConfig{}, StoryboardInferenceModelSnapshot{}, err
	}
	return modelConfig, planning, inferenceSnapshot, nil
}

func validateStoryboardVideoParameters(
	parameters StoryboardVideoParameters,
	planning StoryboardPlanningConfig,
	capabilities applicationmodel.VideoCapabilities,
) error {
	config := domainvideo.Config{
		ModelServiceID: "validated-during-storyboard-planning",
		Resolution:     parameters.Resolution, AspectRatio: parameters.AspectRatio,
		DurationSeconds: planning.CanvasNodeDurationMinSeconds,
		GenerateAudio:   parameters.GenerateAudio, Watermark: parameters.Watermark,
	}
	return videoConfigMismatchError(capabilities, config, 0)
}

func normalizeStoryboardPlanningConfigForVideo(
	value StoryboardPlanningConfig,
	capabilities applicationmodel.VideoCapabilities,
) StoryboardPlanningConfig {
	if value.CanvasNodeDurationMinSeconds <= 0 || value.CanvasNodeDurationMaxSeconds <= 0 {
		// Clients deployed before the configurable range send zero values. Use the
		// selected video model's full capability range for those requests.
		value.CanvasNodeDurationMinSeconds = capabilities.DurationMinSeconds
		value.CanvasNodeDurationMaxSeconds = capabilities.DurationMaxSeconds
	}
	return value
}

func validateStoryboardPlanningForVideo(
	value StoryboardPlanningConfig,
	capabilities applicationmodel.VideoCapabilities,
) error {
	if !validStoryboardPlanningConfig(value) || !validStoryboardRequestedTotalDuration(value) {
		return errno.NewWithMessage(
			errno.ErrInvalidArgument,
			"视频模型的分镜时长能力不合法，或总视频时长未设置为 1-50 分钟内的完整范围",
		)
	}
	if (capabilities.DurationMinSeconds > 0 && value.CanvasNodeDurationMinSeconds < capabilities.DurationMinSeconds) ||
		(capabilities.DurationMaxSeconds > 0 && value.CanvasNodeDurationMaxSeconds > capabilities.DurationMaxSeconds) {
		return errno.NewWithMessage(
			errno.ErrInvalidArgument,
			fmt.Sprintf(
				"分镜时长范围 %d-%d 秒与当前视频模型支持的 %s不匹配",
				value.CanvasNodeDurationMinSeconds, value.CanvasNodeDurationMaxSeconds,
				videoDurationCapabilityRange(capabilities),
			),
		)
	}
	return nil
}

func videoDurationCapabilityRange(capabilities applicationmodel.VideoCapabilities) string {
	switch {
	case capabilities.DurationMinSeconds > 0 && capabilities.DurationMaxSeconds > 0:
		return fmt.Sprintf("%d-%d 秒", capabilities.DurationMinSeconds, capabilities.DurationMaxSeconds)
	case capabilities.DurationMinSeconds > 0:
		return fmt.Sprintf("至少 %d 秒", capabilities.DurationMinSeconds)
	case capabilities.DurationMaxSeconds > 0:
		return fmt.Sprintf("最多 %d 秒", capabilities.DurationMaxSeconds)
	default:
		return "时长范围"
	}
}

func (s *CanvasNodeService) GenerateDrafts(
	ctx context.Context,
	scope Scope,
	taskRunID, projectID, canvasID, plot string,
	modelConfig StoryboardModelConfig,
	planning StoryboardPlanningConfig,
	_ int,
	modelCalls StoryboardModelCallLedger,
	emit func(Draft) error,
) error {
	return s.GenerateDraftsWithState(
		ctx, scope, taskRunID, projectID, canvasID, plot, modelConfig, planning,
		StoryboardGenerationState{ProtocolVersion: StoryboardGenerationProtocolVersion}, modelCalls,
		func(StoryboardGenerationState) error { return nil }, emit,
	)
}

func (s *CanvasNodeService) GenerateDraftsWithState(
	ctx context.Context,
	scope Scope,
	taskRunID, projectID, canvasID, plot string,
	modelConfig StoryboardModelConfig,
	planning StoryboardPlanningConfig,
	generation StoryboardGenerationState,
	modelCalls StoryboardModelCallLedger,
	checkpoint func(StoryboardGenerationState) error,
	emit func(Draft) error,
) error {
	if !validCallerScope(scope) || strings.TrimSpace(taskRunID) == "" || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		strings.TrimSpace(plot) == "" ||
		utf8.RuneCountInString(plot) > storyboardPlotHardLimitCharacters ||
		s.splitter == nil || checkpoint == nil || emit == nil {
		return errno.New(errno.ErrInvalidArgument)
	}
	if s.models == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	inferenceModel, err := s.models.LoadSelection(ctx, scope.TenantID, applicationmodel.CapabilityStoryboardInference, modelConfig.InferenceModelServiceID)
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		return errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if strings.TrimSpace(inferenceModel.ModelID) == "" {
		return errno.New(errno.ErrModelDependencyError)
	}
	planning = normalizeStoryboardPlanningConfig(planning)
	if !validStoryboardPlanningConfig(planning) {
		return errno.New(errno.ErrInvalidArgument)
	}
	constraints := StoryboardConstraints{
		TenantID:                scope.TenantID,
		CallerID:                scope.CallerID,
		ProjectID:               projectID,
		DurationMinSeconds:      planning.CanvasNodeDurationMinSeconds,
		DurationMaxSeconds:      planning.CanvasNodeDurationMaxSeconds,
		TotalDurationMinSeconds: planning.TotalDurationMinSeconds,
		TotalDurationMaxSeconds: planning.TotalDurationMaxSeconds,
		VideoParameters:         modelConfig.VideoParameters,
	}
	videoCapabilities, err := s.videoCapabilities(ctx, scope, modelConfig.VideoModelServiceID)
	if err != nil {
		return err
	}
	constraints.VideoDurationMinSeconds = videoCapabilities.DurationMinSeconds
	constraints.VideoDurationMaxSeconds = videoCapabilities.DurationMaxSeconds
	var assetSnapshot *storyboardAssetSnapshot
	if s.assetCatalog != nil {
		assetSnapshot = &storyboardAssetSnapshot{load: func(loadCtx context.Context) ([]ProjectAssetCandidate, error) {
			return s.listStoryboardAssets(loadCtx, scope, projectID, canvasID)
		}}
		constraints.LoadAssetCandidates = assetSnapshot.Load
		constraints.AssetLimits = storyboardAssetLimits(videoCapabilities)
	}
	return s.generateStoryboardDrafts(
		ctx, taskRunID, inferenceModel, plot, constraints, assetSnapshot, videoCapabilities,
		generation, modelCalls, checkpoint, emit,
	)
}

func (s *CanvasNodeService) generateStoryboardDrafts(
	ctx context.Context,
	taskRunID string,
	inferenceModel applicationmodel.Selection,
	plot string,
	constraints StoryboardConstraints,
	assetSnapshot *storyboardAssetSnapshot,
	videoCapabilities applicationmodel.VideoCapabilities,
	generation StoryboardGenerationState,
	modelCalls StoryboardModelCallLedger,
	checkpoint func(StoryboardGenerationState) error,
	emit func(Draft) error,
) error {
	emitCandidate := func(candidate StoryboardDraft) error {
		minimumDuration := constraints.DurationMinSeconds
		maximumDuration := constraints.DurationMaxSeconds
		if constraints.VideoDurationMinSeconds > 0 && constraints.VideoDurationMaxSeconds >= constraints.VideoDurationMinSeconds {
			minimumDuration = constraints.VideoDurationMinSeconds
			maximumDuration = constraints.VideoDurationMaxSeconds
		}
		if strings.TrimSpace(candidate.ID) == "" || candidate.CanvasNodeNo < 1 ||
			candidate.DurationSeconds < minimumDuration ||
			(maximumDuration > 0 && candidate.DurationSeconds > maximumDuration) ||
			!utf8.ValidString(candidate.Prompt) || strings.TrimSpace(candidate.Prompt) == "" ||
			utf8.RuneCountInString(candidate.Prompt) > 50000 {
			return errno.New(errno.ErrInvalidArgument)
		}
		var candidates []ProjectAssetCandidate
		if len(candidate.AssetReferences) > 0 {
			var loadErr error
			candidates, loadErr = assetSnapshot.ProjectCandidates(ctx)
			if loadErr != nil {
				return loadErr
			}
		}
		_, selected, referenceErr := insertSelectedStoryboardAssetMentions(
			candidate.Prompt, candidate.AssetReferences, candidates, videoCapabilities,
		)
		if referenceErr != nil {
			return referenceErr
		}
		references := append([]StoryboardAssetReference(nil), candidate.AssetReferences...)
		for index := range references {
			references[index].AssetID = selected[index].Asset.ID
			references[index].Label = selected[index].Name
			references[index].MediaType = selected[index].Asset.MediaType
		}
		return emit(Draft{
			// Draft prompts stay plain for human review. ConfirmStoryboardDrafts repeats the
			// validation and inserts durable canvas-node mentions after adoption.
			ID: candidate.ID, CanvasNodeNo: candidate.CanvasNodeNo, Prompt: candidate.Prompt,
			DurationSeconds: candidate.DurationSeconds, AssetReferences: references,
		})
	}
	err := s.splitter.SplitWithState(ctx, taskRunID, inferenceModel, plot, constraints, generation, modelCalls, checkpoint, emitCandidate)
	if err != nil {
		var safeError interface{ UserSafeMessage() string }
		if errors.As(err, &safeError) {
			return errno.WrapWithMessage(
				errno.ErrModelDependencyError, safeError.UserSafeMessage(), err,
			)
		}
		return errno.Wrap(errno.ErrModelDependencyError, err)
	}
	return nil
}

func normalizeStoryboardPlanningConfig(value StoryboardPlanningConfig) StoryboardPlanningConfig {
	if value.CanvasNodeDurationMinSeconds == 0 {
		value.CanvasNodeDurationMinSeconds = storyboardPlanningDurationMinSeconds
	}
	if value.CanvasNodeDurationMaxSeconds == 0 {
		value.CanvasNodeDurationMaxSeconds = storyboardPlanningDurationMaxSeconds
	}
	return value
}

func validStoryboardPlanningConfig(value StoryboardPlanningConfig) bool {
	validCanvasNodeDuration := value.CanvasNodeDurationMinSeconds >= 1 &&
		value.CanvasNodeDurationMaxSeconds >= value.CanvasNodeDurationMinSeconds &&
		value.CanvasNodeDurationMaxSeconds <= 300
	if !validCanvasNodeDuration {
		return false
	}
	return value.TotalDurationMinSeconds >= 0 && value.TotalDurationMaxSeconds >= 0 &&
		(value.TotalDurationMaxSeconds == 0 || value.TotalDurationMaxSeconds >= value.TotalDurationMinSeconds)
}

func validStoryboardRequestedTotalDuration(value StoryboardPlanningConfig) bool {
	if value.TotalDurationMinSeconds == 0 && value.TotalDurationMaxSeconds == 0 {
		// Keep requests from clients deployed before the total-duration control
		// operational throughout the rolling release window.
		return true
	}
	return value.TotalDurationMinSeconds >= storyboardTotalDurationMinSeconds &&
		value.TotalDurationMaxSeconds <= storyboardTotalDurationMaxSeconds &&
		value.TotalDurationMaxSeconds >= value.TotalDurationMinSeconds
}

func (s *CanvasNodeService) ConfirmStoryboardDrafts(
	ctx context.Context,
	scope Scope,
	projectID, canvasID string,
	inputs []CanvasNodeDraftConfirmInput,
) ([]domain.CanvasNode, int64, error) {
	if !validCallerScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		len(inputs) < 1 || s.graphRepository == nil {
		return nil, 0, errno.New(errno.ErrInvalidArgument)
	}
	for _, input := range inputs {
		prompt := strings.TrimSpace(input.Prompt)
		if !utf8.ValidString(prompt) || prompt == "" || utf8.RuneCountInString(prompt) > 50000 ||
			!input.GenerationConfig.Valid() {
			return nil, 0, errno.New(errno.ErrInvalidArgument)
		}
	}
	modelCapabilities := make(map[string]applicationmodel.VideoCapabilities, len(inputs))
	for _, input := range inputs {
		modelID := input.GenerationConfig.ModelServiceID
		if _, exists := modelCapabilities[modelID]; exists {
			continue
		}
		capabilities, err := s.videoCapabilities(ctx, scope, modelID)
		if err != nil {
			return nil, 0, err
		}
		modelCapabilities[modelID] = capabilities
	}
	now := s.clock.Now()
	candidates, err := s.listStoryboardAssets(ctx, scope, projectID, canvasID)
	if err != nil {
		return nil, 0, err
	}
	created := make([]domain.CanvasNode, 0, len(inputs))
	matchedByIndex := make([][]ProjectAssetCandidate, 0, len(inputs))
	for _, input := range inputs {
		prompt := strings.TrimSpace(input.Prompt)
		capabilities := modelCapabilities[input.GenerationConfig.ModelServiceID]
		prompt, matched, referenceErr := insertSelectedStoryboardAssetMentions(
			prompt, input.AssetReferences, candidates, capabilities,
		)
		if referenceErr != nil {
			return nil, 0, referenceErr
		}
		id, err := s.ids.NewID()
		if err != nil {
			return nil, 0, errno.Wrap(errno.ErrInternalError, err)
		}
		item, err := domain.NewCanvasNode(domain.CanvasNodeInput{
			ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			ProjectID: projectID, CanvasID: canvasID, CreatedBy: scope.CallerID,
			Type: domain.NodeTypeVideoGeneration, Name: domain.DefaultCanvasNodeName(domain.NodeTypeVideoGeneration), StoryboardRank: 1,
			VideoInputMode:   domain.VideoInputModeReference,
			GenerationConfig: input.GenerationConfig, Now: now,
		})
		if err != nil {
			return nil, 0, errno.Wrap(errno.ErrInvalidArgument, err)
		}
		item.Prompt = prompt
		created = append(created, item)
		matchedByIndex = append(matchedByIndex, matched)
	}
	assetNodes := make([]domain.CanvasNode, 0)
	// ResourceAssetID is the stable library identity. Reusing one source node
	// keeps the confirmed graph normalized when multiple shots share an asset.
	assetNodesByResourceAssetID := make(map[string]domain.CanvasNode)
	for _, matched := range matchedByIndex {
		for _, candidate := range matched {
			if _, exists := assetNodesByResourceAssetID[candidate.ResourceAssetID]; exists {
				continue
			}
			asset := candidate.Asset
			nodeType, ok := assetNodeType(asset.MediaType)
			if !ok {
				return nil, 0, errno.New(errno.ErrInvalidArgument)
			}
			nodeID, idErr := s.ids.NewID()
			if idErr != nil {
				return nil, 0, errno.Wrap(errno.ErrInternalError, idErr)
			}
			name, nameErr := canvasNodeNameFromSource(candidate.Name, nodeType)
			if nameErr != nil {
				return nil, 0, errno.Wrap(errno.ErrInvalidArgument, nameErr)
			}
			node, nodeErr := domain.NewCanvasNode(domain.CanvasNodeInput{
				ID: nodeID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
				ProjectID: projectID, CanvasID: canvasID, CreatedBy: scope.CallerID,
				Type: nodeType, Name: name, ResourceAssetID: candidate.ResourceAssetID,
				VideoInputMode: domain.VideoInputModeReference, Now: now,
			})
			if nodeErr != nil {
				return nil, 0, errno.Wrap(errno.ErrInvalidArgument, nodeErr)
			}
			assetNodesByResourceAssetID[candidate.ResourceAssetID] = node
			assetNodes = append(assetNodes, node)
		}
	}
	for index := range created {
		replacements := make(map[string]string, len(matchedByIndex[index]))
		orders := make(map[domain.Port]int32)
		for _, candidate := range matchedByIndex[index] {
			source := assetNodesByResourceAssetID[candidate.ResourceAssetID]
			replacements[candidate.ResourceAssetID] = source.ID
			port, ok := referencePortForMedia(candidate.Asset.MediaType)
			if !ok {
				return nil, 0, errno.New(errno.ErrInvalidArgument)
			}
			edgeID, idErr := s.ids.NewID()
			if idErr != nil {
				return nil, 0, errno.Wrap(errno.ErrInternalError, idErr)
			}
			created[index].IncomingEdges = append(created[index].IncomingEdges, domain.IncomingEdge{
				ID: edgeID, SourceNodeID: source.ID, SourcePort: domain.PortOutput,
				TargetPort: port, TargetOrder: orders[port],
			})
			orders[port]++
		}
		rewritten, rewriteErr := domain.ReplaceAssetMentionIDs(created[index].Prompt, replacements)
		if rewriteErr != nil {
			return nil, 0, errno.Wrap(errno.ErrInvalidArgument, rewriteErr)
		}
		created[index].Prompt = rewritten
	}
	var out []domain.CanvasNode
	var canvasRevision int64
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, scope, projectID, canvasID)
		if lockErr != nil {
			return lockErr
		}
		occupied, listErr := s.repository.ListForUpdate(txCtx, scope, projectID, canvasID)
		if listErr != nil {
			return listErr
		}
		for index := range created {
			name, nameErr := allocateNumberedCanvasNodeName(occupied, created[index].Type)
			if nameErr != nil {
				return nameErr
			}
			created[index].Name = name
			occupied = append(occupied, created[index])
		}
		for index := range assetNodes {
			if _, createErr := s.repository.Create(txCtx, assetNodes[index], nil); createErr != nil {
				return createErr
			}
		}
		// Batch storyboard confirmation always appends to the latest committed
		// canvas tail inside this transaction. Middle insertion is exclusively
		// handled by the single-canvasnode Create API.
		after := ""
		for index := range created {
			var anchor *string
			if after != "" {
				anchor = &after
			}
			if _, createErr := s.repository.Create(txCtx, created[index], anchor); createErr != nil {
				return createErr
			}
			after = created[index].ID
		}
		if rebuildErr := s.statistics.Rebuild(txCtx, scope, projectID, canvasID); rebuildErr != nil {
			return rebuildErr
		}
		all, listErr := s.repository.List(txCtx, scope, projectID, canvasID)
		if listErr != nil {
			return listErr
		}
		createdIDs := make(map[string]struct{}, len(created))
		for _, item := range created {
			createdIDs[item.ID] = struct{}{}
		}
		out = make([]domain.CanvasNode, 0, len(created))
		for _, item := range all {
			if _, ok := createdIDs[item.ID]; ok {
				out = append(out, item)
			}
		}
		var advanceErr error
		canvasRevision, advanceErr = s.graphRepository.AdvanceCanvasRevision(txCtx, scope, projectID, canvasID, lockedRevision, s.clock.Now())
		return advanceErr
	})
	if err != nil {
		var bizErr *errno.BizError
		if errors.As(err, &bizErr) {
			return nil, 0, err
		}
		return nil, 0, classify(err)
	}
	return out, canvasRevision, nil
}

func referencePortForMedia(mediaType domainasset.MediaType) (domain.Port, bool) {
	switch mediaType {
	case domainasset.MediaImage:
		return domain.PortReferenceImage, true
	case domainasset.MediaVideo:
		return domain.PortReferenceVideo, true
	case domainasset.MediaAudio:
		return domain.PortReferenceAudio, true
	default:
		return "", false
	}
}

func (s *CanvasNodeService) listStoryboardAssets(
	ctx context.Context,
	scope Scope,
	projectID, canvasID string,
) ([]ProjectAssetCandidate, error) {
	if s.assetCatalog == nil {
		return nil, nil
	}
	items, err := s.assetCatalog.ListProjectAssets(ctx, scope, projectID, storyboardAssetCatalogLimit+1)
	if err != nil {
		s.catalogFailure.ReportStoryboardAssetCatalogFailure(logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			ProjectID: projectID, CanvasID: canvasID,
		}), err)
		return nil, classify(err)
	}
	if len(items) > storyboardAssetCatalogLimit {
		return nil, errno.NewWithMessage(errno.ErrInvalidArgument, "项目素材过多，请缩小资产库后重试")
	}
	return items, nil
}
