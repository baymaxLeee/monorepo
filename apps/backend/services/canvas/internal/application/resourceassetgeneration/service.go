package resourceassetgeneration

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domainresource "github.com/example/monorepo/canvas/internal/domain/resource"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/domain/resourceassetgeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

var ErrGenerationUnavailable = errors.New("resource asset generation unavailable")

type Target struct {
	Scope                                  applicationresource.Scope
	ProjectID, ResourceID, ResourceAssetID string
}

type GetInput struct{ Target }

type UpdateInput struct {
	Target
	Patch            GenerationPatch
	ExpectedRevision int64
}

type GenerationPatch struct {
	Config             domainimagegeneration.ConfigPatch
	UploadedReferences *[]UploadedReferenceInput
	ResourceReferences *[]domainresourceassetgeneration.ResourceReference
}

type StartInput struct {
	Target
	ExpectedRevision int64
}

type StartResult struct{ TaskRunID string }

type CancelInput struct {
	Target
	TaskRunID string
}

type GetRunInput struct {
	Target
	TaskRunID string
}

type Generation struct {
	Prompt             string
	ModelID            string
	Resolution         domainimagegeneration.Resolution
	AspectRatio        domainimagegeneration.AspectRatio
	Watermark          bool
	UploadedReferences []UploadedReference
	ResourceReferences []domainresourceassetgeneration.ResourceReference
	Revision           int64
	ActiveTaskRunID    string
	LatestRun          *Run
}

type UploadedReference struct {
	AssetID    string
	FileName   string
	PreviewURL string
}

type UploadedReferenceReader interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type ResourceReader interface {
	GetResourceAsset(context.Context, applicationresource.GetResourceAssetInput) (domainresource.ResourceAsset, error)
	BatchGetResourceAssets(context.Context, applicationresource.BatchGetResourceAssetsInput) ([]domainresource.ResourceAsset, error)
}

type DraftBusinessService interface {
	Get(context.Context, DraftGetInput) (domainresourceassetgeneration.Draft, error)
	Update(context.Context, DraftUpdateInput) (domainresourceassetgeneration.Draft, error)
}

type ImageGenerationEngine interface {
	Start(context.Context, applicationimagegeneration.StartInput) (domainimagegeneration.Run, error)
	Cancel(context.Context, applicationimagegeneration.CancelInput) error
	GetRun(context.Context, applicationimagegeneration.GetRunInput) (applicationimagegeneration.RunView, error)
	ListRuns(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, string) ([]applicationimagegeneration.RunView, error)
	BatchGetLatestRuns(context.Context, applicationimagegeneration.Scope, domainimagegeneration.TargetType, []string) ([]applicationimagegeneration.RunView, error)
}

type ImageModelCatalog interface {
	Resolve(context.Context, applicationmodel.Actor, []applicationmodel.Requirement) ([]applicationmodel.Resolution, error)
}

type Run struct {
	TaskRunID                              string
	Status                                 domaintask.Status
	Prompt, ModelID                        string
	Resolution                             domainimagegeneration.Resolution
	AspectRatio                            domainimagegeneration.AspectRatio
	Watermark                              bool
	Inputs                                 []RunInput
	OutputAssetID, ErrorCode, ErrorMessage string
	StartedAt, FinishedAt, CompletedAt     *time.Time
	CreatedAt, UpdatedAt                   time.Time
}

type GenerationState struct {
	ResourceAssetID string
	Run             Run
}

type RunInputSource int16

const (
	RunInputUploaded RunInputSource = iota + 1
	RunInputResource
)

type RunInput struct {
	Position   int32
	SourceType RunInputSource
	AssetID    string
}

type Service struct {
	resources ResourceReader
	drafts    DraftBusinessService
	engine    ImageGenerationEngine
	models    ImageModelCatalog
	assets    UploadedReferenceReader
}

type ServiceOption func(*Service)

func WithImageModelCatalog(models ImageModelCatalog) ServiceOption {
	return func(service *Service) {
		service.models = models
	}
}

func WithUploadedReferenceReader(reader UploadedReferenceReader) ServiceOption {
	return func(service *Service) { service.assets = reader }
}

func NewService(resources ResourceReader, drafts DraftBusinessService, engine ImageGenerationEngine, options ...ServiceOption) *Service {
	service := &Service{resources: resources, drafts: drafts, engine: engine}
	for _, option := range options {
		option(service)
	}
	return service
}

func newService(resources ResourceReader, drafts DraftBusinessService, engine ImageGenerationEngine, options ...ServiceOption) *Service {
	return NewService(resources, drafts, engine, options...)
}

func (service *Service) Get(ctx context.Context, input GetInput) (Generation, error) {
	if service == nil || service.drafts == nil || service.engine == nil {
		return Generation{}, classifyError(ErrGenerationUnavailable)
	}
	slot, err := service.resolve(ctx, input.Target)
	if err != nil {
		return Generation{}, classifyError(err)
	}
	draft, err := service.drafts.Get(ctx, DraftGetInput{Scope: draftScopeFromResource(input.Scope), DraftID: slot.ImageGenerationDraftID})
	if err != nil {
		return Generation{}, classifyError(err)
	}
	runs, err := service.engine.ListRuns(ctx, imageScope(input.Scope), domainimagegeneration.TargetResourceAsset, slot.ImageGenerationDraftID)
	if err != nil {
		return Generation{}, classifyError(err)
	}
	result, err := service.generationView(ctx, input.Scope, draft)
	if err != nil {
		return Generation{}, err
	}
	if len(runs) > 0 {
		latest := runView(runs[0])
		result.LatestRun = &latest
	}
	return result, nil
}

func (service *Service) BatchGetStates(ctx context.Context, target Target, resourceAssetIDs []string) ([]GenerationState, error) {
	if service == nil || service.resources == nil || service.engine == nil || strings.TrimSpace(target.Scope.TenantID) == "" || strings.TrimSpace(target.Scope.CallerID) == "" || strings.TrimSpace(target.ProjectID) == "" || strings.TrimSpace(target.ResourceID) == "" || len(resourceAssetIDs) == 0 || len(resourceAssetIDs) > 100 {
		return nil, classifyError(errno.New(errno.ErrInvalidArgument))
	}
	unique := make([]string, 0, len(resourceAssetIDs))
	seen := make(map[string]struct{}, len(resourceAssetIDs))
	for _, id := range resourceAssetIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, classifyError(errno.New(errno.ErrInvalidArgument))
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			unique = append(unique, id)
		}
	}
	assets, err := service.resources.BatchGetResourceAssets(ctx, applicationresource.BatchGetResourceAssetsInput{Scope: target.Scope, ProjectID: target.ProjectID, ResourceAssetIDs: unique})
	if err != nil {
		return nil, classifyError(err)
	}
	assetByDraft := make(map[string]string, len(assets))
	draftIDs := make([]string, 0, len(assets))
	for _, asset := range assets {
		if asset.ResourceID == target.ResourceID && asset.ImageGenerationDraftID != "" {
			assetByDraft[asset.ImageGenerationDraftID] = asset.ID
			draftIDs = append(draftIDs, asset.ImageGenerationDraftID)
		}
	}
	if len(draftIDs) == 0 {
		return []GenerationState{}, nil
	}
	runs, err := service.engine.BatchGetLatestRuns(ctx, imageScope(target.Scope), domainimagegeneration.TargetResourceAsset, draftIDs)
	if err != nil {
		return nil, classifyError(err)
	}
	statesByAsset := make(map[string]GenerationState, len(runs))
	for _, item := range runs {
		if assetID := assetByDraft[item.Detail.Target.ID]; assetID != "" {
			statesByAsset[assetID] = GenerationState{ResourceAssetID: assetID, Run: runView(item)}
		}
	}
	result := make([]GenerationState, 0, len(statesByAsset))
	for _, assetID := range unique {
		if state, found := statesByAsset[assetID]; found {
			result = append(result, state)
		}
	}
	return result, nil
}

func (service *Service) Update(ctx context.Context, input UpdateInput) (Generation, error) {
	if service == nil || service.drafts == nil {
		return Generation{}, classifyError(ErrGenerationUnavailable)
	}
	slot, err := service.resolve(ctx, input.Target)
	if err != nil {
		return Generation{}, classifyError(err)
	}
	draft, err := service.drafts.Update(ctx, DraftUpdateInput{
		Scope: draftScopeFromResource(input.Scope), ProjectID: input.ProjectID, DraftID: slot.ImageGenerationDraftID,
		Patch: DraftPatch{
			Config: input.Patch.Config, UploadedReferences: input.Patch.UploadedReferences, ResourceReferences: input.Patch.ResourceReferences,
		}, ExpectedRevision: input.ExpectedRevision,
	})
	if err != nil {
		return Generation{}, classifyError(err)
	}
	return service.generationView(ctx, input.Scope, draft)
}

func (service *Service) Start(ctx context.Context, input StartInput) (StartResult, error) {
	if service == nil || service.engine == nil || service.drafts == nil {
		return StartResult{}, classifyError(ErrGenerationUnavailable)
	}
	slot, err := service.resolve(ctx, input.Target)
	if err != nil {
		return StartResult{}, classifyError(err)
	}
	draft, err := service.drafts.Get(ctx, DraftGetInput{
		Scope: draftScopeFromResource(input.Scope), DraftID: slot.ImageGenerationDraftID,
	})
	if err != nil {
		return StartResult{}, classifyError(err)
	}
	if !draft.Ready() {
		return StartResult{}, classifyError(ErrDraftConfigIncomplete)
	}
	resolved, err := service.validateImageConfig(ctx, input.Scope, draft)
	if err != nil {
		return StartResult{}, err
	}
	run, err := service.engine.Start(ctx, applicationimagegeneration.StartInput{
		Scope: imageScope(input.Scope), TargetType: domainimagegeneration.TargetResourceAsset,
		TargetID: slot.ImageGenerationDraftID, ExpectedRevision: input.ExpectedRevision,
		ProjectID: input.ProjectID, ModelName: resolved.ModelName, ModelSource: string(resolved.ModelSource),
	})
	if err != nil {
		return StartResult{}, classifyError(err)
	}
	return StartResult{TaskRunID: run.TaskRunID}, nil
}

func (service *Service) validateImageConfig(
	ctx context.Context,
	scope applicationresource.Scope,
	draft domainresourceassetgeneration.Draft,
) (applicationmodel.Resolution, error) {
	if service.models == nil {
		return applicationmodel.Resolution{}, errno.New(errno.ErrConfigurationError)
	}
	capability := applicationmodel.CapabilityResourceTextToImage
	if len(draft.UploadedReferences) > 0 || len(draft.ResourceReferences) > 0 {
		capability = applicationmodel.CapabilityResourceImageToImage
	}
	resolved, err := service.models.Resolve(ctx, applicationmodel.Actor{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		UserID: scope.CallerID,
	}, []applicationmodel.Requirement{{Capability: capability, ModelID: draft.Config.ModelID}})
	if err != nil {
		if errors.Is(err, applicationmodel.ErrDefaultModelNotConfigured) {
			return applicationmodel.Resolution{}, errno.Wrap(errno.ErrDefaultModelNotConfigured, err)
		}
		if errors.Is(err, applicationmodel.ErrUnavailable) {
			return applicationmodel.Resolution{}, errno.Wrap(errno.ErrModelUnavailable, err)
		}
		return applicationmodel.Resolution{}, errno.Wrap(errno.ErrModelDependencyError, err)
	}
	if len(resolved) != 1 || resolved[0].ImageCapabilities == nil {
		return applicationmodel.Resolution{}, errno.New(errno.ErrModelDependencyError)
	}
	width, height, err := domainimagegeneration.Dimensions(draft.Config.Resolution, draft.Config.AspectRatio)
	if err != nil {
		return applicationmodel.Resolution{}, classifyError(err)
	}
	capabilities := *resolved[0].ImageCapabilities
	referenceCount := len(draft.UploadedReferences) + len(draft.ResourceReferences)
	mismatches := capabilities.MismatchedConfigs(applicationmodel.ImageParameters{
		Width: width, Height: height, Watermark: draft.Config.Watermark, InputReferences: referenceCount,
	})
	if len(mismatches) == 0 {
		return resolved[0], nil
	}
	if maximum := capabilities.TotalPixels.Max; maximum > 0 && width*height > maximum {
		return applicationmodel.Resolution{}, errno.NewWithMessage(
			errno.ErrInvalidArgument,
			fmt.Sprintf("当前模型最大支持 %d 像素，请降低分辨率或调整比例", maximum),
		)
	}
	if maximum := capabilities.MaxInputReferences; maximum != nil && referenceCount > *maximum {
		return applicationmodel.Resolution{}, errno.NewWithMessage(
			errno.ErrInvalidArgument,
			fmt.Sprintf("当前模型最多支持 %d 张参考图", *maximum),
		)
	}
	return applicationmodel.Resolution{}, errno.NewWithMessage(errno.ErrInvalidArgument, fmt.Sprintf("当前模型与%s不匹配", strings.Join(mismatches, "、")))
}

func (service *Service) Cancel(ctx context.Context, input CancelInput) error {
	if service == nil || service.engine == nil {
		return classifyError(ErrGenerationUnavailable)
	}
	slot, err := service.resolve(ctx, input.Target)
	if err != nil {
		return classifyError(err)
	}
	return classifyError(service.engine.Cancel(ctx, applicationimagegeneration.CancelInput{
		Scope: imageScope(input.Scope), TargetType: domainimagegeneration.TargetResourceAsset,
		TargetID: slot.ImageGenerationDraftID, TaskRunID: input.TaskRunID,
	}))
}

func (service *Service) GetRun(ctx context.Context, input GetRunInput) (Run, error) {
	if service == nil || service.engine == nil {
		return Run{}, classifyError(ErrGenerationUnavailable)
	}
	slot, err := service.resolve(ctx, input.Target)
	if err != nil {
		return Run{}, classifyError(err)
	}
	view, err := service.engine.GetRun(ctx, applicationimagegeneration.GetRunInput{
		Scope: imageScope(input.Scope), TargetType: domainimagegeneration.TargetResourceAsset,
		TargetID: slot.ImageGenerationDraftID, TaskRunID: input.TaskRunID,
	})
	if err != nil {
		return Run{}, classifyError(err)
	}
	return runView(view), nil
}

func (service *Service) resolve(ctx context.Context, target Target) (domainresource.ResourceAsset, error) {
	if service == nil || service.resources == nil {
		return domainresource.ResourceAsset{}, ErrGenerationUnavailable
	}
	slot, err := service.resources.GetResourceAsset(ctx, applicationresource.GetResourceAssetInput{
		Scope: target.Scope, ProjectID: target.ProjectID, ResourceID: target.ResourceID, ResourceAssetID: target.ResourceAssetID,
	})
	if err != nil {
		return domainresource.ResourceAsset{}, err
	}
	if slot.SourceType != domainresource.SourceGenerated || slot.ImageGenerationDraftID == "" {
		return domainresource.ResourceAsset{}, ErrGenerationUnavailable
	}
	return slot, nil
}

func (service *Service) generationView(ctx context.Context, scope applicationresource.Scope, draft domainresourceassetgeneration.Draft) (Generation, error) {
	view := Generation{
		Prompt: draft.Config.Prompt, ModelID: draft.Config.ModelID, Resolution: draft.Config.Resolution,
		AspectRatio: draft.Config.AspectRatio, Watermark: draft.Config.Watermark,
		Revision: draft.Revision, ActiveTaskRunID: draft.ActiveTaskRunID,
	}
	view.UploadedReferences = make([]UploadedReference, len(draft.UploadedReferences))
	references := make([]applicationasset.AssetReference, len(draft.UploadedReferences))
	for index, reference := range draft.UploadedReferences {
		view.UploadedReferences[index].AssetID = reference.AssetID
		references[index] = applicationasset.AssetReference{
			Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetGenerationUpload, Key: draft.ID}, AssetID: reference.AssetID,
		}
	}
	if len(references) > 0 && service.assets != nil {
		resolved, err := service.assets.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{
			Scope: applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, References: references,
		})
		if err != nil {
			return Generation{}, classifyError(err)
		}
		byReference := make(map[applicationasset.AssetReference]applicationasset.PresignedReferencedAsset, len(resolved))
		for _, item := range resolved {
			byReference[item.Reference] = item
		}
		for index, reference := range references {
			if item, ok := byReference[reference]; ok {
				view.UploadedReferences[index].FileName = item.Asset.FileName
				view.UploadedReferences[index].PreviewURL = item.URL
			}
		}
	}
	view.ResourceReferences = append(view.ResourceReferences, draft.ResourceReferences...)
	return view, nil
}

func imageScope(scope applicationresource.Scope) applicationimagegeneration.Scope {
	return applicationimagegeneration.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}
}

func draftScopeFromResource(scope applicationresource.Scope) DraftScope {
	return DraftScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}
}

func runView(view applicationimagegeneration.RunView) Run {
	result := Run{
		TaskRunID: view.Detail.TaskRunID, Status: view.TaskRun.Status,
		Prompt: view.Detail.Config.Prompt, ModelID: view.Detail.Config.ModelID, Resolution: view.Detail.Config.Resolution,
		AspectRatio: view.Detail.Config.AspectRatio, Watermark: view.Detail.Config.Watermark,
		ErrorCode: view.TaskRun.ErrorCode, ErrorMessage: view.TaskRun.ErrorMessage,
		StartedAt: view.TaskRun.StartedAt, FinishedAt: view.TaskRun.FinishedAt,
		OutputAssetID: view.Detail.OutputAssetID, CompletedAt: view.Detail.CompletedAt,
		CreatedAt: view.Detail.CreatedAt, UpdatedAt: view.Detail.UpdatedAt,
	}
	for _, input := range view.Detail.Inputs {
		source := RunInputUploaded
		if input.SourceType == domainimagegeneration.InputSourceResourceAsset {
			source = RunInputResource
		}
		result.Inputs = append(result.Inputs, RunInput{Position: input.Position, SourceType: source, AssetID: input.AssetID})
	}
	return result
}

func classifyError(err error) error {
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
	case errors.Is(err, ErrGenerationUnavailable), errors.Is(err, domainresource.ErrResourceAssetSourceTypeMismatch):
		return errno.Wrap(errno.ErrResourceAssetSourceTypeMismatch, err)
	case errors.Is(err, ErrDraftNotFound), errors.Is(err, applicationtask.ErrNotFound):
		return errno.Wrap(errno.ErrResourceAssetGenerationNotFound, err)
	case errors.Is(err, ErrDraftRevisionConflict), errors.Is(err, domainresourceassetgeneration.ErrRevisionConflict):
		return errno.Wrap(errno.ErrResourceAssetGenerationRevisionConflict, err)
	case errors.Is(err, ErrDraftRunActive):
		return errno.Wrap(errno.ErrResourceAssetGenerationRunActive, err)
	case errors.Is(err, ErrDraftConfigIncomplete):
		return errno.Wrap(errno.ErrResourceAssetGenerationConfigIncomplete, err)
	case errors.Is(err, ErrDraftReferenceInvalid):
		return errno.Wrap(errno.ErrResourceAssetGenerationReferenceInvalid, err)
	case errors.Is(err, ErrDraftRunConflict), errors.Is(err, applicationimagegeneration.ErrRunConflict):
		return errno.Wrap(errno.ErrResourceAssetGenerationRunConflict, err)
	case errors.Is(err, domainimagegeneration.ErrInvalidGeneration), errors.Is(err, domainresourceassetgeneration.ErrInvalidDraft):
		return errno.Wrap(errno.ErrInvalidArgument, err)
	default:
		return errno.Wrap(errno.ErrInternalError, err)
	}
}
