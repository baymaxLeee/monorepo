package canvas

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type CanvasNodeService struct {
	repository          CanvasNodeRepository
	deletion            *applicationdeletion.Queue
	graphRepository     CanvasGraphRepository
	transactions        TransactionManager
	statistics          CanvasStatisticsRebuilder
	statisticsProjector CanvasStatisticsProjector
	projectStatistics   applicationprojectstatistics.Projector
	ids                 IDGenerator
	clock               Clock
	splitter            StoryboardSplitter
	assetMatcher        PromptAssetMatcher
	assetMatchTasks     *assetMatchTasks
	models              applicationmodel.Catalog
	canceller           ActiveGenerationCanceller
	cancelFailure       CancellationFailureReporter
	visibility          TaskVisibilityHider
	visibilityFailure   VisibilityFailureReporter
	previewer           SelectedOutputPreviewer
	assetReader         CanvasNodeAssetReader
	previewFailure      FramePreviewFailureReporter
	assetCatalog        StoryboardAssetCatalog
	catalogFailure      StoryboardAssetCatalogFailureReporter
	assetReferences     CanvasAssetReferenceTracker
	assets              CanvasAssetResolver
	resources           CanvasResourceResolver
	resourceBatch       CanvasResourceBatchResolver
	resourceAssets      CanvasResourceAssetResolver
	resourceAssetBatch  CanvasResourceAssetBatchResolver
	canvases            CanvasScopeResolver
	assetCreator        CanvasAssetCreator
}

type CanvasNodeOption func(*CanvasNodeService)

func WithMutationDependencies(transactions TransactionManager, statistics CanvasStatisticsRebuilder) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.transactions = transactions
		service.statistics = statistics
	}
}

func WithCanvasNodeProjectStatistics(projector applicationprojectstatistics.Projector) CanvasNodeOption {
	return func(service *CanvasNodeService) { service.projectStatistics = projector }
}

func WithCanvasStatisticsProjector(projector CanvasStatisticsProjector) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		if projector != nil {
			service.statisticsProjector = projector
		}
	}
}

func WithStoryboardSplitter(splitter StoryboardSplitter) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.splitter = splitter
	}
}

func WithModelCatalog(models applicationmodel.Catalog) CanvasNodeOption {
	return func(service *CanvasNodeService) { service.models = models }
}

func WithActiveGenerationCanceller(canceller ActiveGenerationCanceller) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.canceller = canceller
	}
}

func WithCancellationFailureReporter(reporter CancellationFailureReporter) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		if reporter != nil {
			service.cancelFailure = reporter
		}
	}
}

func WithTaskVisibility(hider TaskVisibilityHider, reporter VisibilityFailureReporter) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		if hider != nil {
			service.visibility = hider
		}
		if reporter != nil {
			service.visibilityFailure = reporter
		}
	}
}

func WithSelectedOutputPreviewer(previewer SelectedOutputPreviewer, reporter FramePreviewFailureReporter) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.previewer = previewer
		if reporter != nil {
			service.previewFailure = reporter
		}
	}
}

func WithCanvasNodeAssetReader(reader CanvasNodeAssetReader) CanvasNodeOption {
	return func(service *CanvasNodeService) { service.assetReader = reader }
}

func WithStoryboardAssetAutoAttach(
	catalog StoryboardAssetCatalog,
	reporter StoryboardAssetCatalogFailureReporter,
) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		if catalog == nil {
			return
		}
		service.assetCatalog = catalog
		if reporter != nil {
			service.catalogFailure = reporter
		}
	}
}

func WithCanvasNodeAssetReferences(tracker CanvasAssetReferenceTracker) CanvasNodeOption {
	return func(service *CanvasNodeService) { service.assetReferences = tracker }
}

func WithCanvasAssetResolver(resolver CanvasAssetResolver) CanvasNodeOption {
	return func(service *CanvasNodeService) { service.assets = resolver }
}

func WithCanvasNodeUploadCreation(canvases CanvasScopeResolver, creator CanvasAssetCreator) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.canvases = canvases
		service.assetCreator = creator
	}
}

func WithCanvasResourceAssetResolvers(resolver CanvasResourceAssetResolver, batchResolver CanvasResourceAssetBatchResolver) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.resourceAssets = resolver
		service.resourceAssetBatch = batchResolver
	}
}

func WithCanvasResourceResolvers(resolver CanvasResourceResolver, batchResolver CanvasResourceBatchResolver) CanvasNodeOption {
	return func(service *CanvasNodeService) {
		service.resources = resolver
		service.resourceBatch = batchResolver
	}
}

func NewCanvasNodeService(
	repository CanvasNodeRepository,
	ids IDGenerator,
	clock Clock,
	options ...CanvasNodeOption,
) *CanvasNodeService {
	service := &CanvasNodeService{
		repository: repository, transactions: directTransactionManager{}, statistics: noopCanvasStatisticsRebuilder{},
		statisticsProjector: noopCanvasStatisticsProjector{},
		ids:                 ids, clock: clock, cancelFailure: noopCancellationFailureReporter{},
		visibility: noopTaskVisibilityHider{}, visibilityFailure: noopVisibilityFailureReporter{},
		previewFailure: noopFramePreviewFailureReporter{},
		catalogFailure: noopStoryboardAssetCatalogFailureReporter{},
	}
	service.graphRepository = repository
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *CanvasNodeService) List(ctx context.Context, scope Scope, projectID, canvasID string) ([]domain.CanvasNode, error) {
	if !validCallerScope(scope) || projectID == "" || canvasID == "" {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	items, err := s.repository.List(ctx, scope, projectID, canvasID)
	if err != nil {
		return nil, classify(err)
	}
	if err = s.resolveCurrentResourceAssets(ctx, scope, projectID, items); err != nil {
		return nil, err
	}
	return items, nil
}

type CanvasNodeView struct {
	AssetsMatching bool
	domain.CanvasNode
	PreviewURL string
	Reviews    []domainasset.Review
}

func (s *CanvasNodeService) ListGraph(ctx context.Context, scope Scope, projectID, canvasID string) ([]CanvasNodeView, error) {
	items, err := s.List(ctx, scope, projectID, canvasID)
	if err != nil {
		return nil, err
	}
	return s.ProjectViews(ctx, scope, items)
}

func (s *CanvasNodeService) ProjectViews(ctx context.Context, scope Scope, items []domain.CanvasNode) ([]CanvasNodeView, error) {
	views := make([]CanvasNodeView, len(items))
	for index := range items {
		views[index].CanvasNode = items[index]
	}
	if err := s.projectAssetsMatching(ctx, scope, views); err != nil {
		return nil, err
	}
	if s.assetReader == nil {
		return views, nil
	}
	references := make([]applicationasset.AssetReference, 0, len(items)*2)
	mainReferences := make(map[string]applicationasset.AssetReference, len(items))
	frameReferences := make(map[string]applicationasset.AssetReference, len(items))
	for _, item := range items {
		if reference, ok := canvasNodeMainAssetReference(item); ok {
			references = append(references, reference)
			mainReferences[item.ID] = reference
		}
		if item.FirstFrameAssetID != "" && item.SelectedOutputID != "" {
			reference := applicationasset.AssetReference{
				Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: item.SelectedOutputID},
				AssetID: item.FirstFrameAssetID,
			}
			references = append(references, reference)
			frameReferences[item.ID] = reference
		}
	}
	if len(references) == 0 {
		return views, nil
	}
	resolved, err := s.assetReader.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{
		Scope:      applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID},
		References: references,
	})
	if err != nil {
		return nil, err
	}
	byReference := make(map[applicationasset.AssetReference]applicationasset.PresignedReferencedAsset, len(resolved))
	for _, item := range resolved {
		byReference[item.Reference] = item
	}
	for index := range views {
		if reference, ok := mainReferences[views[index].ID]; ok {
			if item, found := byReference[reference]; found {
				views[index].PreviewURL = item.URL
				views[index].Reviews = item.Asset.Reviews
			}
		}
		if reference, ok := frameReferences[views[index].ID]; ok {
			if item, found := byReference[reference]; found {
				views[index].FirstFrameURL = item.URL
			}
		}
	}
	return views, nil
}

func canvasNodeMainAssetReference(item domain.CanvasNode) (applicationasset.AssetReference, bool) {
	if item.AssetID != "" {
		return applicationasset.AssetReference{
			Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerCanvasNodeAsset, Key: item.ID}, AssetID: item.AssetID,
		}, true
	}
	if item.CurrentAssetID != "" && item.ResourceAssetID != "" {
		return applicationasset.AssetReference{
			Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: item.ResourceAssetID}, AssetID: item.CurrentAssetID,
		}, true
	}
	if item.SelectedAssetID == "" || item.SelectedOutputID == "" {
		return applicationasset.AssetReference{}, false
	}
	ownerType := applicationasset.ReferenceOwnerVideoGenerationOutput
	if item.Type == domain.NodeTypeImageGeneration {
		ownerType = applicationasset.ReferenceOwnerImageGenerationOutput
	}
	return applicationasset.AssetReference{
		Owner: applicationasset.ReferenceOwner{Type: ownerType, Key: item.SelectedOutputID}, AssetID: item.SelectedAssetID,
	}, true
}

func (s *CanvasNodeService) ListIDs(ctx context.Context, scope Scope, projectID, canvasID string) ([]string, error) {
	if !validCallerScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	items, err := s.repository.ListIDs(ctx, scope, projectID, canvasID)
	if err != nil {
		return nil, classify(err)
	}
	return items, nil
}

func (s *CanvasNodeService) resolveCurrentResourceAssets(ctx context.Context, scope Scope, projectID string, items []domain.CanvasNode) error {
	resourceIDs := make([]string, 0, len(items))
	seenResources := make(map[string]struct{}, len(items))
	resourceAssetIDs := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index := range items {
		resourceID := strings.TrimSpace(items[index].ResourceID)
		if resourceID != "" {
			if s.resourceBatch == nil {
				return errno.New(errno.ErrInternalError)
			}
			if _, exists := seenResources[resourceID]; !exists {
				seenResources[resourceID] = struct{}{}
				resourceIDs = append(resourceIDs, resourceID)
			}
			continue
		}
		id := strings.TrimSpace(items[index].ResourceAssetID)
		if id == "" {
			continue
		}
		if s.resourceAssetBatch == nil {
			return errno.New(errno.ErrInternalError)
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		resourceAssetIDs = append(resourceAssetIDs, id)
	}
	if len(resourceIDs) > 0 {
		resolved, err := s.resourceBatch.BatchResolvePrimaryResourceAssets(ctx, scope, projectID, resourceIDs)
		if err != nil {
			return classify(err)
		}
		for index := range items {
			if items[index].ResourceID == "" {
				continue
			}
			current, ok := resolved[items[index].ResourceID]
			if !ok {
				items[index].ReferenceStatus = domain.ReferenceStatusDeleted
				continue
			}
			items[index].ReferenceStatus = domain.ReferenceStatusActive
			items[index].ResourceAssetID = current.ResourceAssetID
			items[index].CurrentAssetID = current.Asset.ID
			items[index].ResourceAssetRevision = current.Revision
			items[index].ResourceAssetIsPrimary = current.IsPrimary
			if !items[index].HasPersistedName {
				name, nameErr := canvasNodeNameFromSource(current.Name, items[index].Type)
				if nameErr != nil {
					return errno.Wrap(errno.ErrInvalidArgument, nameErr)
				}
				items[index].Name = name
			}
		}
	}
	if len(resourceAssetIDs) == 0 {
		return nil
	}
	resolved, err := s.resourceAssetBatch.BatchResolveCurrentResourceAssets(ctx, scope, projectID, resourceAssetIDs)
	if err != nil {
		return classify(err)
	}
	for index := range items {
		if items[index].ResourceID != "" || items[index].ResourceAssetID == "" {
			continue
		}
		current, ok := resolved[items[index].ResourceAssetID]
		if !ok {
			items[index].ReferenceStatus = domain.ReferenceStatusDeleted
			continue
		}
		items[index].ReferenceStatus = domain.ReferenceStatusActive
		items[index].CurrentAssetID = current.Asset.ID
		items[index].ResourceAssetRevision = current.Revision
		items[index].ResourceAssetIsPrimary = current.IsPrimary
		if !items[index].HasPersistedName {
			name, nameErr := canvasNodeNameFromSource(current.Name, items[index].Type)
			if nameErr != nil {
				return errno.Wrap(errno.ErrInvalidArgument, nameErr)
			}
			items[index].Name = name
		}
	}
	return nil
}

func (s *CanvasNodeService) addSelectedOutputPreviews(ctx context.Context, scope Scope, items []domain.CanvasNode) {
	if s.previewer == nil {
		return
	}
	references := make([]applicationasset.AssetReference, 0, len(items)*2)
	for index := range items {
		if reference, ok := canvasNodeMainAssetReference(items[index]); ok {
			references = append(references, reference)
		}
		if items[index].FirstFrameAssetID != "" && items[index].SelectedOutputID != "" {
			references = append(references, applicationasset.AssetReference{
				Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: items[index].SelectedOutputID},
				AssetID: items[index].FirstFrameAssetID,
			})
		}
	}
	if len(references) == 0 {
		return
	}
	presigned, err := s.previewer.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{
		Scope:      applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID},
		References: references,
	})
	previewURLs := make(map[applicationasset.AssetReference]string, len(presigned))
	for _, item := range presigned {
		previewURLs[item.Reference] = item.URL
	}
	for index := range items {
		if reference, ok := canvasNodeMainAssetReference(items[index]); ok {
			items[index].SelectedOutputURL = previewURLs[reference]
		}
		frameAssetID := items[index].FirstFrameAssetID
		if frameAssetID == "" || items[index].SelectedOutputID == "" {
			continue
		}
		previewURL := previewURLs[applicationasset.AssetReference{
			Owner:   applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerVideoGenerationFirstFrame, Key: items[index].SelectedOutputID},
			AssetID: frameAssetID,
		}]
		if previewURL == "" {
			failure := err
			if failure == nil {
				failure = errors.New("batch presign omitted first frame asset")
			}
			s.previewFailure.ReportFramePreviewFailure(ctx, scope.TenantID, frameAssetID, failure)
			continue
		}
		items[index].FirstFrameURL = previewURL
	}
}

type noopFramePreviewFailureReporter struct{}

func (noopFramePreviewFailureReporter) ReportFramePreviewFailure(context.Context, string, string, error) {
}

type noopStoryboardAssetCatalogFailureReporter struct{}

func (noopStoryboardAssetCatalogFailureReporter) ReportStoryboardAssetCatalogFailure(context.Context, error) {
}
func (s *CanvasNodeService) Create(ctx context.Context, scope Scope, input CreateNodeInput) (domain.CanvasNode, int32, int64, error) {
	if !validCallerScope(scope) || input.ProjectID == "" || input.CanvasID == "" || !input.Type.Valid() ||
		input.Type == domain.NodeTypeStoryboardDraft || s.graphRepository == nil {
		return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
	}
	var config domainvideo.Config
	if input.Type == domain.NodeTypeVideoGeneration || input.Type == domain.NodeTypeImageGeneration || input.Type == domain.NodeTypeTextGeneration {
		config = domainvideo.DefaultConfig(input.ModelServiceID)
	}
	if input.Type == domain.NodeTypeVideoGeneration {
		if !config.Valid() {
			return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
		}
		capabilities, err := s.videoCapabilities(ctx, scope, config.ModelServiceID)
		if err != nil {
			return domain.CanvasNode{}, 0, 0, err
		}
		if capabilities.AspectRatioAdaptive {
			config.AspectRatio = domainvideo.AspectAdaptive
		}
		for _, duration := range capabilities.DurationRecommends {
			if duration == domainvideo.AutomaticDurationSeconds {
				config.DurationSeconds = domainvideo.AutomaticDurationSeconds
				break
			}
		}
		if err = videoConfigMismatchError(capabilities, config, 0); err != nil {
			return domain.CanvasNode{}, 0, 0, err
		}
	}
	if input.Type == domain.NodeTypeImageGeneration && config.ModelServiceID != "" {
		capabilities, err := s.imageCapabilities(ctx, scope, config.ModelServiceID, 0)
		if err != nil {
			return domain.CanvasNode{}, 0, 0, err
		}
		selected, ok := defaultImageConfig(config, capabilities)
		if ok {
			config = selected
		}
	}
	if input.Type == domain.NodeTypeTextGeneration && config.ModelServiceID != "" {
		if err := s.validateTextModel(ctx, scope, config.ModelServiceID); err != nil {
			return domain.CanvasNode{}, 0, 0, err
		}
	}
	name, err := defaultCanvasNodeName(input.Type)
	if err != nil {
		return domain.CanvasNode{}, 0, 0, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	if input.UploadedAsset != nil {
		if !assetCanvasNodeType(input.Type) || strings.TrimSpace(input.AssetID) != "" || strings.TrimSpace(input.ResourceID) != "" || strings.TrimSpace(input.ResourceAssetID) != "" {
			return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
		}
		createdAsset, createErr := createCanvasProjectAsset(
			ctx, s.canvases, s.assetCreator, scope, input.ProjectID, input.CanvasID, *input.UploadedAsset,
		)
		if createErr != nil {
			return domain.CanvasNode{}, 0, 0, createErr
		}
		if nodeType, ok := assetNodeType(createdAsset.MediaType); !ok || nodeType != input.Type {
			return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
		}
		input.AssetID = createdAsset.ID
	}
	referenceType := domain.ReferenceTypeUnspecified
	if input.Type == domain.NodeTypeImageAsset || input.Type == domain.NodeTypeVideoAsset || input.Type == domain.NodeTypeAudioAsset {
		assetReference := strings.TrimSpace(input.AssetID) != ""
		resourceAssetReference := strings.TrimSpace(input.ResourceAssetID) != ""
		resourceReference := strings.TrimSpace(input.ResourceID) != ""
		if boolCount(assetReference, resourceAssetReference, resourceReference) != 1 {
			return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
		}
		if assetReference {
			referenceType = domain.ReferenceTypeAsset
			resolved, err := resolveProjectAsset(ctx, s.assets, scope, input.ProjectID, input.AssetID)
			if err != nil {
				return domain.CanvasNode{}, 0, 0, classify(err)
			}
			if nodeType, ok := assetNodeType(resolved.MediaType); !ok || nodeType != input.Type {
				return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
			}
			name, err = canvasNodeNameFromSource(resolved.FileName, input.Type)
			if err != nil {
				return domain.CanvasNode{}, 0, 0, errno.Wrap(errno.ErrInvalidArgument, err)
			}
		}
		if resourceAssetReference {
			referenceType = domain.ReferenceTypeResourceAsset
			if s.resourceAssets == nil {
				return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInternalError)
			}
			resolved, resolveErr := s.resourceAssets.ResolveCurrentResourceAsset(ctx, scope, input.ProjectID, input.ResourceAssetID)
			if resolveErr != nil {
				return domain.CanvasNode{}, 0, 0, classify(resolveErr)
			}
			if nodeType, ok := assetNodeType(resolved.Asset.MediaType); !ok || nodeType != input.Type {
				return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
			}
			name, err = canvasNodeNameFromSource(resolved.Name, input.Type)
			if err != nil {
				return domain.CanvasNode{}, 0, 0, errno.Wrap(errno.ErrInvalidArgument, err)
			}
		}
		if resourceReference {
			referenceType = domain.ReferenceTypeResource
			if s.resources == nil {
				return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInternalError)
			}
			resolved, err := s.resources.ResolvePrimaryResourceAsset(ctx, scope, input.ProjectID, input.ResourceID)
			if err != nil {
				return domain.CanvasNode{}, 0, 0, classify(err)
			}
			if nodeType, ok := assetNodeType(resolved.Asset.MediaType); !ok || nodeType != input.Type {
				return domain.CanvasNode{}, 0, 0, errno.New(errno.ErrInvalidArgument)
			}
			name, err = canvasNodeNameFromSource(resolved.Name, input.Type)
			if err != nil {
				return domain.CanvasNode{}, 0, 0, errno.Wrap(errno.ErrInvalidArgument, err)
			}
		}
	}
	id, err := s.ids.NewID()
	if err != nil {
		return domain.CanvasNode{}, 0, 0, errno.Wrap(errno.ErrInternalError, err)
	}
	storyboardRank := int64(0)
	if input.Type == domain.NodeTypeVideoGeneration {
		storyboardRank = 1
	}
	var item domain.CanvasNode
	var after *string
	if normalized := strings.TrimSpace(input.AfterNodeID); normalized != "" {
		after = &normalized
	}
	var canvasnodeNo int32
	var canvasRevision int64
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		if numberedCanvasNodeType(input.Type) {
			existing, listErr := s.repository.ListForUpdate(txCtx, scope, input.ProjectID, input.CanvasID)
			if listErr != nil {
				return listErr
			}
			name, lockErr = allocateNumberedCanvasNodeName(existing, input.Type)
			if lockErr != nil {
				return lockErr
			}
		}
		item, lockErr = domain.NewCanvasNode(domain.CanvasNodeInput{ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
			ProjectID: input.ProjectID, CanvasID: input.CanvasID, CreatedBy: scope.CallerID, Type: input.Type,
			ReferenceType: referenceType, Name: name, Position: input.Position, StoryboardRank: storyboardRank, Text: input.Text, AssetID: input.AssetID,
			ResourceID: input.ResourceID, ResourceAssetID: input.ResourceAssetID,
			VideoInputMode: domain.VideoInputModeReference, GenerationConfig: config, Now: s.clock.Now()})
		if lockErr != nil {
			return lockErr
		}
		var createErr error
		canvasnodeNo, createErr = s.repository.Create(txCtx, item, after)
		if createErr != nil {
			return createErr
		}
		if item.AssetID != "" && s.assetReferences != nil {
			if createErr = s.assetReferences.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{
				Scope:    canvasAssetReferenceScope(scope),
				Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerCanvasNodeAsset, Key: item.ID},
				AssetIDs: []string{item.AssetID},
			}); createErr != nil {
				return createErr
			}
		}
		if rebuildErr := s.statistics.Rebuild(txCtx, scope, input.ProjectID, input.CanvasID); rebuildErr != nil {
			return rebuildErr
		}
		canvasRevision, createErr = s.graphRepository.AdvanceCanvasRevision(txCtx, scope, input.ProjectID, input.CanvasID, lockedRevision, s.clock.Now())
		return createErr
	})
	if err != nil {
		return domain.CanvasNode{}, 0, 0, classify(err)
	}
	created, err := s.repository.Get(ctx, scope, input.ProjectID, input.CanvasID, id)
	if err != nil {
		return domain.CanvasNode{}, 0, 0, classify(err)
	}
	createdItems := []domain.CanvasNode{created}
	if err = s.resolveCurrentResourceAssets(ctx, scope, input.ProjectID, createdItems); err != nil {
		return domain.CanvasNode{}, 0, 0, err
	}
	created = createdItems[0]
	return created, canvasnodeNo, canvasRevision, nil
}

func assetCanvasNodeType(nodeType domain.NodeType) bool {
	return nodeType == domain.NodeTypeImageAsset || nodeType == domain.NodeTypeVideoAsset || nodeType == domain.NodeTypeAudioAsset
}

func (s *CanvasNodeService) Copy(ctx context.Context, scope Scope, input CopyNodeInput) (CopyNodeResult, error) {
	if !validCallerScope(scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.CanvasID) == "" ||
		strings.TrimSpace(input.SourceNodeID) == "" || !input.Position.Valid() || s.graphRepository == nil {
		return CopyNodeResult{}, errno.New(errno.ErrInvalidArgument)
	}
	id, err := s.ids.NewID()
	if err != nil {
		return CopyNodeResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	var created domain.CanvasNode
	var canvasnodeNo int32
	var canvasRevision int64
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		lockedRevision, lockErr := s.graphRepository.LockCanvas(txCtx, scope, input.ProjectID, input.CanvasID)
		if lockErr != nil {
			return lockErr
		}
		source, getErr := s.repository.Get(txCtx, scope, input.ProjectID, input.CanvasID, input.SourceNodeID)
		if getErr != nil {
			return getErr
		}
		if source.Type == domain.NodeTypeStoryboardDraft {
			return domain.ErrInvalidCanvasNode
		}
		sources := []domain.CanvasNode{source}
		if getErr = s.resolveCurrentResourceAssets(txCtx, scope, input.ProjectID, sources); getErr != nil {
			return getErr
		}
		source = sources[0]
		if source.ReferenceStatus == domain.ReferenceStatusDeleted {
			return domain.ErrInvalidCanvasNode
		}
		storyboardRank := int64(0)
		if source.Type == domain.NodeTypeVideoGeneration {
			storyboardRank = 1
		}
		assetID, resourceID, resourceAssetID := "", "", ""
		if assetCanvasNodeType(source.Type) {
			assetID, resourceID, resourceAssetID = source.AssetID, source.ResourceID, source.ResourceAssetID
		}
		created, getErr = domain.NewCanvasNode(domain.CanvasNodeInput{
			ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: input.ProjectID,
			CanvasID: input.CanvasID, CreatedBy: scope.CallerID, Type: source.Type, Name: source.Name, HasPersistedName: source.HasPersistedName,
			Position: input.Position, StoryboardRank: storyboardRank, Prompt: source.Prompt, Text: source.Text,
			ReferenceType: source.ReferenceType, AssetID: assetID, ResourceID: resourceID, ResourceAssetID: resourceAssetID, VideoInputMode: source.VideoInputMode,
			GenerationConfig: source.GenerationConfig, Now: s.clock.Now(),
		})
		if getErr != nil {
			return errno.Wrap(errno.ErrInvalidArgument, getErr)
		}
		// A duplicate starts with no execution history, but its current content
		// remains immediately renderable and consumable by downstream nodes.
		// SelectedOutputID is deliberately not copied because it identifies a
		// TaskRun owned by the source node.
		switch source.Type {
		case domain.NodeTypeTextGeneration:
			created.SelectedOutputText = source.SelectedOutputText
		}
		canvasnodeNo, getErr = s.repository.Create(txCtx, created, &input.SourceNodeID)
		if getErr != nil {
			return getErr
		}
		if getErr = s.acquireCanvasNodeReferences(txCtx, scope, created); getErr != nil {
			return getErr
		}
		if rebuildErr := s.statistics.Rebuild(txCtx, scope, input.ProjectID, input.CanvasID); rebuildErr != nil {
			return rebuildErr
		}
		canvasRevision, getErr = s.graphRepository.AdvanceCanvasRevision(
			txCtx, scope, input.ProjectID, input.CanvasID, lockedRevision, s.clock.Now(),
		)
		return getErr
	})
	if err != nil {
		return CopyNodeResult{}, classify(err)
	}
	items := []domain.CanvasNode{created}
	if err := s.resolveCurrentResourceAssets(ctx, scope, input.ProjectID, items); err != nil {
		return CopyNodeResult{}, err
	}
	s.addSelectedOutputPreviews(ctx, scope, items)
	created = items[0]
	return CopyNodeResult{CanvasNode: created, CanvasNodeNo: canvasnodeNo, CanvasRevision: canvasRevision}, nil
}

func boolCount(values ...bool) int {
	count := 0
	for _, value := range values {
		if value {
			count++
		}
	}
	return count
}

func (s *CanvasNodeService) acquireCanvasNodeReferences(ctx context.Context, scope Scope, item domain.CanvasNode) error {
	if s.assetReferences == nil {
		return nil
	}
	if item.AssetID != "" {
		return s.assetReferences.AcquireAssets(ctx, applicationasset.AcquireAssetsInput{
			Scope:    canvasAssetReferenceScope(scope),
			Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerCanvasNodeAsset, Key: item.ID},
			AssetIDs: []string{item.AssetID},
		})
	}
	return nil
}

func (s *CanvasNodeService) releaseCanvasNodeReferences(ctx context.Context, scope Scope, item domain.CanvasNode) error {
	if s.assetReferences == nil {
		return nil
	}
	return s.assetReferences.ReleaseAllAssets(ctx, applicationasset.ReleaseAllAssetsInput{
		Scope: canvasAssetReferenceScope(scope),
		Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerCanvasNodeAsset, Key: item.ID},
	})
}
func (s *CanvasNodeService) Update(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID string, patch UpdatePatch) (UpdateResult, error) {
	if !validCallerScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" || strings.TrimSpace(canvasnodeID) == "" || patch.Empty() {
		return UpdateResult{}, errno.New(errno.ErrInvalidArgument)
	}
	item, err := s.repository.Get(ctx, scope, projectID, canvasID, canvasnodeID)
	if err != nil {
		return UpdateResult{}, classify(err)
	}
	if item.Type == domain.NodeTypeStoryboardDraft && !positionOnlyUpdate(patch.Content) {
		return UpdateResult{}, errno.New(errno.ErrInvalidArgument)
	}
	items := []domain.CanvasNode{item}
	if err = s.resolveCurrentResourceAssets(ctx, scope, projectID, items); err != nil {
		return UpdateResult{}, err
	}
	item = items[0]
	if item.ReferenceStatus == domain.ReferenceStatusDeleted && !positionOnlyUpdate(patch.Content) {
		return UpdateResult{}, errno.New(errno.ErrInvalidArgument)
	}
	patch.Content.ExpectedRevision = item.Revision
	prospectiveEdges := item.IncomingEdges
	if patch.Content.VideoInputMode != nil {
		nodes, listErr := s.repository.List(ctx, scope, projectID, canvasID)
		if listErr != nil {
			return UpdateResult{}, classify(listErr)
		}
		transitioned, transitionErr := domain.TransitionVideoInputModeEdges(
			item.IncomingEdges,
			*patch.Content.VideoInputMode,
		)
		if transitionErr != nil {
			return UpdateResult{}, classifyGraphMutation(transitionErr)
		}
		patch.Content.IncomingEdges = &transitioned
		prospectiveEdges = transitioned
		if validateErr := domain.ValidateIncomingEdges(
			nodes,
			item.ID,
			transitioned,
			*patch.Content.VideoInputMode,
		); validateErr != nil {
			return UpdateResult{}, classifyGraphMutation(validateErr)
		}
	}
	if !patch.Content.GenerationConfig.Empty() {
		prospectiveConfig := patch.Content.GenerationConfig.Apply(item.GenerationConfig)
		if !prospectiveConfig.Valid() {
			return UpdateResult{}, errno.New(errno.ErrInvalidArgument)
		}
		var validationErr error
		switch item.Type {
		case domain.NodeTypeTextGeneration:
			validationErr = s.validateTextModel(ctx, scope, prospectiveConfig.ModelServiceID)
		case domain.NodeTypeImageGeneration:
			validationErr = s.validateImageConfig(ctx, scope, prospectiveConfig, imageReferenceCount(prospectiveEdges))
		case domain.NodeTypeVideoGeneration:
			validationErr = s.validateVideoConfig(ctx, scope, prospectiveConfig, prospectiveEdges)
		default:
			validationErr = errno.New(errno.ErrInvalidArgument)
		}
		if validationErr != nil {
			return UpdateResult{}, validationErr
		}
	}
	prospectivePrompt := item.Prompt
	if patch.Content.Prompt != nil {
		prospectivePrompt = *patch.Content.Prompt
	}
	if _, mentionErr := domain.AssetMentionIDs(prospectivePrompt); mentionErr != nil {
		return UpdateResult{}, errno.Wrap(errno.ErrInvalidArgument, mentionErr)
	}
	var canvasnodeNo int32
	var revokedTaskRunID string
	err = s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if patch.Content.Name != nil {
			if !domain.ValidCanvasNodeName(*patch.Content.Name) {
				return domain.ErrInvalidCanvasNode
			}
		}
		locked, getErr := s.repository.GetForUpdate(txCtx, scope, projectID, canvasID, canvasnodeID)
		if getErr != nil {
			return getErr
		}
		if locked.ActiveTaskRunID != "" && !positionOnlyUpdate(patch.Content) {
			return ErrRevisionConflict
		}
		item = locked
		patch.Content.ExpectedRevision = item.Revision
		if updateDomainErr := item.Update(patch.Content, scope.CallerID, s.clock.Now()); updateDomainErr != nil {
			return errno.Wrap(errno.ErrInvalidArgument, updateDomainErr)
		}
		var updateErr error
		canvasnodeNo, _, revokedTaskRunID, updateErr = s.repository.Update(txCtx, item, patch.Content)
		if updateErr != nil {
			return updateErr
		}
		return nil
	})
	if err != nil {
		return UpdateResult{}, classify(err)
	}
	s.statisticsProjector.Refresh(ctx, scope, projectID, canvasID)
	if patch.Content.GenerationConfig.DurationSeconds != nil {
		s.refreshProjectStatistics(ctx, scope, projectID)
	}
	if s.canceller != nil && revokedTaskRunID != "" {
		revoked := item
		revoked.ActiveTaskRunID = revokedTaskRunID
		if cancelErr := s.canceller.CancelActive(ctx, scope, revoked); cancelErr != nil {
			s.reportCancellationFailure(ctx, scope, revoked, cancelErr)
		}
	}
	updated, err := s.repository.Get(ctx, scope, projectID, canvasID, canvasnodeID)
	if err != nil {
		return UpdateResult{}, classify(err)
	}
	updatedItems := []domain.CanvasNode{updated}
	if err = s.resolveCurrentResourceAssets(ctx, scope, projectID, updatedItems); err != nil {
		return UpdateResult{}, err
	}
	return UpdateResult{CanvasNode: updatedItems[0], CanvasNodeNo: canvasnodeNo}, nil
}

func positionOnlyUpdate(patch domain.UpdatePatch) bool {
	return patch.Position != nil && patch.Name == nil && patch.Prompt == nil && patch.Text == nil &&
		patch.IncomingEdges == nil && patch.VideoInputMode == nil && patch.GenerationConfig.Empty()
}

func (s *CanvasNodeService) BatchUpdatePositions(
	ctx context.Context,
	scope Scope,
	projectID string,
	canvasID string,
	updates []CanvasNodePositionUpdate,
) (BatchUpdatePositionsResult, error) {
	if !validCallerScope(scope) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(canvasID) == "" ||
		len(updates) == 0 || len(updates) > maxBatchPositionUpdates {
		return BatchUpdatePositionsResult{}, errno.New(errno.ErrInvalidArgument)
	}
	seen := make(map[string]struct{}, len(updates))
	for _, update := range updates {
		if strings.TrimSpace(update.NodeID) == "" || !update.Position.Valid() {
			return BatchUpdatePositionsResult{}, errno.New(errno.ErrInvalidArgument)
		}
		if _, duplicate := seen[update.NodeID]; duplicate {
			return BatchUpdatePositionsResult{}, errno.New(errno.ErrInvalidArgument)
		}
		seen[update.NodeID] = struct{}{}
	}

	result := BatchUpdatePositionsResult{Items: make([]domain.CanvasNode, 0, len(updates))}
	err := s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		ids := make([]string, 0, len(updates))
		for _, update := range updates {
			ids = append(ids, update.NodeID)
		}
		sort.Strings(ids)
		byID := make(map[string]domain.CanvasNode, len(ids))
		for _, id := range ids {
			item, getErr := s.repository.GetForUpdate(txCtx, scope, projectID, canvasID, id)
			if getErr != nil {
				return getErr
			}
			byID[id] = item
		}
		for _, update := range updates {
			item := byID[update.NodeID]
			patch := domain.UpdatePatch{ExpectedRevision: item.Revision, Position: &update.Position}
			if updateErr := item.Update(patch, scope.CallerID, s.clock.Now()); updateErr != nil {
				return updateErr
			}
			if _, _, _, updateErr := s.repository.Update(txCtx, item, patch); updateErr != nil {
				return updateErr
			}
			result.Items = append(result.Items, item)
		}
		return nil
	})
	if err != nil {
		return BatchUpdatePositionsResult{}, classify(err)
	}
	if err = s.resolveCurrentResourceAssets(ctx, scope, projectID, result.Items); err != nil {
		return BatchUpdatePositionsResult{}, err
	}
	return result, nil
}

func (s *CanvasNodeService) videoCapabilities(
	ctx context.Context,
	scope Scope,
	modelID string,
) (applicationmodel.VideoCapabilities, error) {
	if s.models == nil {
		return applicationmodel.VideoCapabilities{}, errno.New(errno.ErrConfigurationError)
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
	}, []applicationmodel.Requirement{{Capability: applicationmodel.CapabilityCanvasNodeVideo, ModelID: modelID}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return applicationmodel.VideoCapabilities{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return applicationmodel.VideoCapabilities{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return applicationmodel.VideoCapabilities{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 || resolved[0].VideoCapabilities == nil {
		return applicationmodel.VideoCapabilities{}, errno.New(errno.ErrModelDependencyError)
	}
	return *resolved[0].VideoCapabilities, nil
}

func (s *CanvasNodeService) validateVideoConfig(
	ctx context.Context,
	scope Scope,
	config domainvideo.Config,
	edges []domain.IncomingEdge,
) error {
	capabilities, err := s.videoCapabilities(ctx, scope, config.ModelServiceID)
	if err != nil {
		return err
	}
	if err = validateCanvasNodeInputLimits(canvasNodeInputLimits{
		image: capabilities.MaxImageReferences,
		video: capabilities.MaxVideoReferences,
		audio: capabilities.MaxAudioReferences,
	}, edges); err != nil {
		return err
	}
	return videoConfigMismatchError(capabilities, config, 0)
}

type canvasNodeInputLimits struct {
	image *int
	video *int
	audio *int
}

func (s *CanvasNodeService) resolveCanvasNodeInputLimits(
	ctx context.Context,
	scope Scope,
	target domain.CanvasNode,
) (canvasNodeInputLimits, error) {
	switch target.Type {
	case domain.NodeTypeImageGeneration:
		if s.models == nil {
			return canvasNodeInputLimits{}, errno.New(errno.ErrConfigurationError)
		}
		resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
			TenantID: scope.TenantID,
			UserID:   scope.CallerID,
		}, []applicationmodel.Requirement{{
			Capability: applicationmodel.CapabilityResourceImageToImage,
			ModelID:    target.GenerationConfig.ModelServiceID,
		}})
		if err != nil {
			if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
				return canvasNodeInputLimits{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
			}
			if errors.Is(err, applicationmodel.ErrUnavailable) {
				return canvasNodeInputLimits{}, errno.Wrap(errno.ErrModelUnavailable, err)
			}
			return canvasNodeInputLimits{}, errno.Wrap(errno.ErrModelDependencyError, err)
		}
		if len(resolved) != 1 || resolved[0].ImageCapabilities == nil {
			return canvasNodeInputLimits{}, errno.New(errno.ErrModelDependencyError)
		}
		return canvasNodeInputLimits{image: resolved[0].ImageCapabilities.MaxInputReferences}, nil
	case domain.NodeTypeVideoGeneration:
		capabilities, err := s.videoCapabilities(ctx, scope, target.GenerationConfig.ModelServiceID)
		if err != nil {
			return canvasNodeInputLimits{}, err
		}
		return canvasNodeInputLimits{
			image: capabilities.MaxImageReferences,
			video: capabilities.MaxVideoReferences,
			audio: capabilities.MaxAudioReferences,
		}, nil
	default:
		return canvasNodeInputLimits{}, nil
	}
}

func validateCanvasNodeInputLimits(limits canvasNodeInputLimits, edges []domain.IncomingEdge) error {
	counts := struct {
		image int
		video int
		audio int
	}{}
	for _, edge := range edges {
		switch edge.TargetPort {
		case domain.PortReferenceImage, domain.PortFirstFrame, domain.PortLastFrame:
			counts.image++
		case domain.PortReferenceVideo:
			counts.video++
		case domain.PortReferenceAudio:
			counts.audio++
		}
	}
	if limits.image != nil && counts.image > *limits.image {
		return canvasNodeInputLimitError("图片", "张", *limits.image)
	}
	if limits.video != nil && counts.video > *limits.video {
		return canvasNodeInputLimitError("视频", "个", *limits.video)
	}
	if limits.audio != nil && counts.audio > *limits.audio {
		return canvasNodeInputLimitError("音频", "个", *limits.audio)
	}
	return nil
}

func canvasNodeInputLimitError(media, unit string, maximum int) error {
	if maximum == 0 {
		return errno.NewWithMessage(errno.ErrCanvasNodeAssetLimitExceeded, fmt.Sprintf("当前模型不支持%s素材", media))
	}
	return errno.NewWithMessage(
		errno.ErrCanvasNodeAssetLimitExceeded,
		fmt.Sprintf("当前模型最多支持 %d %s%s素材", maximum, unit, media),
	)
}

func (s *CanvasNodeService) validateImageConfig(ctx context.Context, scope Scope, config domainvideo.Config, referenceCount int) error {
	capabilities, err := s.imageCapabilities(ctx, scope, config.ModelServiceID, referenceCount)
	if err != nil {
		return err
	}
	return imageConfigMismatchError(capabilities, config, referenceCount)
}

func (s *CanvasNodeService) imageCapabilities(
	ctx context.Context,
	scope Scope,
	modelServiceID string,
	referenceCount int,
) (applicationmodel.ImageCapabilities, error) {
	if s.models == nil {
		return applicationmodel.ImageCapabilities{}, errno.New(errno.ErrConfigurationError)
	}
	capability := applicationmodel.CapabilityResourceTextToImage
	if referenceCount > 0 {
		capability = applicationmodel.CapabilityResourceImageToImage
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
	}, []applicationmodel.Requirement{{Capability: capability, ModelID: modelServiceID}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return applicationmodel.ImageCapabilities{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return applicationmodel.ImageCapabilities{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return applicationmodel.ImageCapabilities{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 || resolved[0].ImageCapabilities == nil {
		return applicationmodel.ImageCapabilities{}, errno.New(errno.ErrModelDependencyError)
	}
	return *resolved[0].ImageCapabilities, nil
}

func defaultImageConfig(config domainvideo.Config, capabilities applicationmodel.ImageCapabilities) (domainvideo.Config, bool) {
	// Keep the existing 720P portrait product default whenever possible. When a
	// model rejects it, preserve the portrait composition before trying other
	// product-supported aspect ratios instead of inventing provider pixel sizes.
	resolutions := []domainvideo.Resolution{
		domainvideo.Resolution720,
		domainvideo.Resolution1080,
		domainvideo.Resolution2K,
		domainvideo.Resolution4K,
		domainvideo.Resolution480,
	}
	aspectRatios := []domainvideo.AspectRatio{
		domainvideo.Aspect9x16,
		domainvideo.Aspect16x9,
		domainvideo.Aspect1x1,
		domainvideo.Aspect3x4,
		domainvideo.Aspect4x3,
		domainvideo.Aspect3x2,
		domainvideo.Aspect2x3,
		domainvideo.Aspect21x9,
	}
	for _, aspectRatio := range aspectRatios {
		for _, resolution := range resolutions {
			candidate := config
			candidate.Resolution = resolution
			candidate.AspectRatio = aspectRatio
			if imageConfigMismatchError(capabilities, candidate, 0) == nil {
				return candidate, true
			}
		}
	}
	return domainvideo.Config{}, false
}

func imageConfigMismatchError(capabilities applicationmodel.ImageCapabilities, config domainvideo.Config, referenceCount int) error {
	width, height, err := domainimagegeneration.Dimensions(
		canvasImageResolution(config.Resolution),
		domainimagegeneration.AspectRatio(config.AspectRatio.ProviderValue()),
	)
	if err != nil {
		return errno.Wrap(errno.ErrInvalidArgument, err)
	}
	mismatches := capabilities.MismatchedConfigs(applicationmodel.ImageParameters{
		Width: width, Height: height, Watermark: config.Watermark, InputReferences: referenceCount,
	})
	if len(mismatches) == 0 {
		return nil
	}
	if maximum := capabilities.TotalPixels.Max; maximum > 0 && width*height > maximum {
		return errno.NewWithMessage(errno.ErrInvalidArgument, fmt.Sprintf("当前模型最大支持 %d 像素，请降低分辨率或调整比例", maximum))
	}
	if maximum := capabilities.MaxInputReferences; maximum != nil && referenceCount > *maximum {
		return canvasNodeInputLimitError("图片", "张", *maximum)
	}
	return errno.NewWithMessage(errno.ErrInvalidArgument, fmt.Sprintf("当前模型与%s不匹配", strings.Join(mismatches, "、")))
}

func canvasImageResolution(value domainvideo.Resolution) domainimagegeneration.Resolution {
	switch value {
	case domainvideo.Resolution480:
		return domainimagegeneration.Resolution480P
	case domainvideo.Resolution720:
		return domainimagegeneration.Resolution720P
	case domainvideo.Resolution1080:
		return domainimagegeneration.Resolution1080P
	case domainvideo.Resolution2K:
		return domainimagegeneration.Resolution2K
	case domainvideo.Resolution4K:
		return domainimagegeneration.Resolution4K
	default:
		return ""
	}
}

func imageReferenceCount(edges []domain.IncomingEdge) int {
	count := 0
	for _, edge := range edges {
		if edge.TargetPort == domain.PortReferenceImage {
			count++
		}
	}
	return count
}

func (s *CanvasNodeService) validateTextModel(ctx context.Context, scope Scope, modelID string) error {
	if s.models == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	resolved, err := s.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID,
		UserID:   scope.CallerID,
	}, []applicationmodel.Requirement{{
		Capability: applicationmodel.CapabilityCanvasTextGeneration,
		ModelID:    modelID,
	}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 || strings.TrimSpace(resolved[0].Selection.ModelID) == "" {
		return errno.New(errno.ErrModelDependencyError)
	}
	return nil
}

func videoParameters(config domainvideo.Config) applicationmodel.VideoParameters {
	return applicationmodel.VideoParameters{
		Resolution: config.Resolution.ProviderValue(), AspectRatio: config.AspectRatio.ProviderValue(),
		DurationSeconds: config.DurationSeconds, GenerateAudio: config.GenerateAudio, Watermark: config.Watermark,
	}
}

func videoConfigMismatchError(capabilities applicationmodel.VideoCapabilities, config domainvideo.Config, canvasnodeNo int) error {
	mismatches := capabilities.MismatchedConfigs(videoParameters(config))
	if len(mismatches) == 0 {
		return nil
	}
	detail := strings.Join(mismatches, "、")
	if canvasnodeNo > 0 {
		return errno.NewWithMessage(
			errno.ErrInvalidArgument,
			fmt.Sprintf("第 %d 个分镜的模型与%s不匹配", canvasnodeNo, detail),
		)
	}
	return errno.NewWithMessage(errno.ErrInvalidArgument, fmt.Sprintf("当前模型与%s不匹配", detail))
}

func (s *CanvasNodeService) Delete(ctx context.Context, scope Scope, projectID, canvasID, canvasnodeID string) error {
	_, err := s.DeleteNode(ctx, DeleteNodeInput{
		Scope: scope, ProjectID: projectID, CanvasID: canvasID, NodeID: canvasnodeID,
	})
	return err
}

func (s *CanvasNodeService) refreshProjectStatistics(ctx context.Context, scope Scope, projectID string) {
	if s.projectStatistics != nil {
		projectCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: projectID,
		})
		s.projectStatistics.Refresh(projectCtx, applicationprojectstatistics.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		}, projectID, applicationprojectstatistics.SelectedVideoDurationField)
	}
}

func (s *CanvasNodeService) reportCancellationFailure(ctx context.Context, scope Scope, item domain.CanvasNode, err error) {
	s.cancelFailure.Report(logcontext.WithBusiness(ctx, logcontext.Business{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		ProjectID: item.ProjectID, CanvasID: item.CanvasID, NodeID: item.ID, TaskRunID: item.ActiveTaskRunID,
	}), err)
}

type directTransactionManager struct{}

func (directTransactionManager) WithinTransaction(ctx context.Context, run func(context.Context) error) error {
	return run(ctx)
}

type noopCanvasStatisticsRebuilder struct{}

func (noopCanvasStatisticsRebuilder) Rebuild(context.Context, Scope, string, string) error {
	return nil
}

type noopCancellationFailureReporter struct{}

func (noopCancellationFailureReporter) Report(context.Context, error) {}

type noopTaskVisibilityHider struct{}

func (noopTaskVisibilityHider) HideByCanvasNodes(context.Context, Scope, []string, time.Time) error {
	return nil
}

type noopVisibilityFailureReporter struct{}

func (noopVisibilityFailureReporter) ReportVisibilityFailure(context.Context, error) {}

func validCallerScope(scope Scope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}

func resolveProjectAsset(ctx context.Context, resolver CanvasAssetResolver, scope Scope, projectID, assetID string) (domainasset.Asset, error) {
	if resolver == nil {
		return domainasset.Asset{}, errno.New(errno.ErrConfigurationError)
	}
	item, err := resolver.BypassGet(ctx, applicationasset.BypassGetInput{
		Scope: applicationasset.Scope{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID,
		},
		AssetID: assetID,
	})
	if err != nil {
		return domainasset.Asset{}, err
	}
	// Standalone Canvas assets are Project-owned. Resource-owned assets must be
	// consumed through ResourceAsset so its Project scope and revision remain authoritative.
	if item.OwnerType != domainasset.OwnerProject || item.OwnerID != projectID {
		return domainasset.Asset{}, ErrNotFound
	}
	return item, nil
}

func classify(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) {
		return errno.Wrap(errno.ErrNotFound, err)
	}
	if errors.Is(err, ErrCanvasNodeLimitExceeded) {
		return errno.Wrap(errno.ErrCanvasNodeLimitExceeded, err)
	}
	if errors.Is(err, ErrAssetMissing) {
		return errno.Wrap(errno.ErrCanvasNodeAssetMissing, err)
	}
	if errors.Is(err, ErrRevisionConflict) {
		return errno.Wrap(errno.ErrConflict, err)
	}
	if errors.Is(err, domain.ErrInvalidCanvasNode) {
		return errno.Wrap(errno.ErrInvalidArgument, err)
	}
	return errno.Ensure(errno.ErrPersistenceError, err)
}
