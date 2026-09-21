package http

import (
	"context"
	"strings"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/http/topcontext"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	applicationresourceassetgeneration "github.com/example/monorepo/canvas/internal/server/application/resourceassetgeneration"
	contractasset "github.com/example/monorepo/canvas/internal/server/contracts/asset"
	contractbase "github.com/example/monorepo/canvas/internal/server/contracts/base"
	contractcommon "github.com/example/monorepo/canvas/internal/server/contracts/common"
	contractresource "github.com/example/monorepo/canvas/internal/server/contracts/resource"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/server/domain/imagegeneration"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/server/domain/resourceassetgeneration"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type resourceService interface {
	Create(context.Context, applicationresource.CreateInput) (applicationresource.CreateResult, error)
	CreateFromAsset(context.Context, applicationresource.CreateFromAssetInput) (applicationresource.CreateFromAssetResult, error)
	Get(context.Context, applicationresource.GetInput) (domainresource.Resource, error)
	BatchGet(context.Context, applicationresource.BatchGetInput) ([]domainresource.Resource, error)
	List(context.Context, applicationresource.ListInput) ([]domainresource.Resource, int64, error)
	GetProjectResourceStats(context.Context, applicationresource.GetProjectResourceStatsInput) (applicationresource.ResourceStats, error)
	Update(context.Context, applicationresource.UpdateInput) (domainresource.Resource, error)
	Delete(context.Context, applicationresource.DeleteInput) error
	BatchDelete(context.Context, applicationresource.BatchDeleteInput) error
	ListResourceAssets(context.Context, applicationresource.ListResourceAssetsInput) ([]domainresource.ResourceAsset, int64, error)
	BatchListResourceAssets(context.Context, applicationresource.BatchListResourceAssetsInput) ([]applicationresource.ResourceAssetGroup, error)
	GetResourceAsset(context.Context, applicationresource.GetResourceAssetInput) (domainresource.ResourceAsset, error)
	BatchGetResourceAssets(context.Context, applicationresource.BatchGetResourceAssetsInput) ([]domainresource.ResourceAsset, error)
	CreateResourceAsset(context.Context, applicationresource.CreateResourceAssetInput) (domainresource.ResourceAsset, error)
	CreateGeneratedResourceAsset(context.Context, applicationresource.CreateGeneratedResourceAssetInput) (domainresource.ResourceAsset, domainresourceassetgeneration.Draft, error)
	RenameResourceAsset(context.Context, applicationresource.RenameResourceAssetInput) (domainresource.ResourceAsset, error)
	ReplaceUploadedResourceAsset(context.Context, applicationresource.ReplaceUploadedResourceAssetInput) (domainresource.ResourceAsset, error)
	SetPrimaryResourceAsset(context.Context, applicationresource.SetPrimaryResourceAssetInput) (domainresource.Resource, error)
	DeleteResourceAsset(context.Context, applicationresource.DeleteResourceAssetInput) error
	BatchDeleteResourceAssets(context.Context, applicationresource.BatchDeleteResourceAssetsInput) error
}

type resourceAssetGenerationService interface {
	Get(context.Context, applicationresourceassetgeneration.GetInput) (applicationresourceassetgeneration.Generation, error)
	BatchGetStates(context.Context, applicationresourceassetgeneration.Target, []string) ([]applicationresourceassetgeneration.GenerationState, error)
	Update(context.Context, applicationresourceassetgeneration.UpdateInput) (applicationresourceassetgeneration.Generation, error)
	Start(context.Context, applicationresourceassetgeneration.StartInput) (applicationresourceassetgeneration.StartResult, error)
	Cancel(context.Context, applicationresourceassetgeneration.CancelInput) error
	GetRun(context.Context, applicationresourceassetgeneration.GetRunInput) (applicationresourceassetgeneration.Run, error)
}

type resourceAssetReader interface {
	BatchPresignReferencedAssets(context.Context, applicationasset.BatchGetReferencedAssetsInput) ([]applicationasset.PresignedReferencedAsset, error)
}

type ResourceHandler struct {
	service     resourceService
	assets      resourceAssetReader
	generations resourceAssetGenerationService
}

func NewResourceHandler(service *applicationresource.Service, assets *applicationasset.Service, generations *applicationresourceassetgeneration.Service) *ResourceHandler {
	return buildResourceHandler(service, assets, generations)
}
func buildResourceHandler(service resourceService, assets resourceAssetReader, generations ...resourceAssetGenerationService) *ResourceHandler {
	var generationService resourceAssetGenerationService
	if len(generations) > 0 {
		generationService = generations[0]
	}
	return &ResourceHandler{service: service, assets: assets, generations: generationService}
}

func (h *ResourceHandler) ListResources(ctx context.Context, request *contractresource.ListResourcesRequest) (*contractresource.ListResourcesResponse, error) {
	if err := requireAction(ctx, "ListResources"); err != nil {
		return nil, err
	}
	if request.Page == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	sortField, sortDirection, err := resourceSort(request.Sort)
	if err != nil {
		return nil, err
	}
	items, total, err := h.service.List(ctx, applicationresource.ListInput{Scope: scope, ProjectID: request.ProjectID, Type: resourceTypePointer(request.Type), Keyword: stringValue(request.Keyword), SortField: sortField, SortDirection: sortDirection, Page: applicationresource.Page{PageSize: int(request.Page.PageSize), PageNum: int(request.Page.PageNum)}})
	if err != nil {
		return nil, err
	}
	dtos, err := h.resourceDTOs(ctx, scope, request.ProjectID, items)
	if err != nil {
		return nil, err
	}
	return &contractresource.ListResourcesResponse{Items: dtos, Page: pageOutput(request.Page.PageSize, request.Page.PageNum, total)}, nil
}

func (h *ResourceHandler) GetProjectResourceStats(ctx context.Context, request *contractresource.GetProjectResourceStatsRequest) (*contractresource.GetProjectResourceStatsResponse, error) {
	if err := requireAction(ctx, "GetProjectResourceStats"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	stats, err := h.service.GetProjectResourceStats(ctx, applicationresource.GetProjectResourceStatsInput{
		Scope:     resourceScope(ctx, request.WorkspaceID),
		ProjectID: request.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	return &contractresource.GetProjectResourceStatsResponse{
		Stats: &contractresource.ProjectResourceStats{
			CharacterCount: stats.CharacterCount,
			SceneCount:     stats.SceneCount,
			PropCount:      stats.PropCount,
			AudioCount:     stats.AudioCount,
		},
	}, nil
}

func (h *ResourceHandler) GetResource(ctx context.Context, request *contractresource.GetResourceRequest) (*contractresource.GetResourceResponse, error) {
	if err := requireAction(ctx, "GetResource"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	item, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	dto, err := h.resourceDTO(ctx, scope, request.ProjectID, item)
	return &contractresource.GetResourceResponse{Resource: dto}, err
}

func (h *ResourceHandler) BatchGetResources(ctx context.Context, request *contractresource.BatchGetResourcesRequest) (*contractresource.BatchGetResourcesResponse, error) {
	if err := requireAction(ctx, "BatchGetResources"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	items, err := h.service.BatchGet(ctx, applicationresource.BatchGetInput{Scope: scope, ProjectID: request.ProjectID, ResourceIDs: request.ResourceIDs})
	if err != nil {
		return nil, err
	}
	dtos, err := h.resourceDTOs(ctx, scope, request.ProjectID, items)
	return &contractresource.BatchGetResourcesResponse{Items: dtos}, err
}

func (h *ResourceHandler) CreateResource(ctx context.Context, request *contractresource.CreateResourceRequest) (*contractresource.CreateResourceResponse, error) {
	if err := requireAction(ctx, "CreateResource"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	initialAssets := make([]applicationresource.InitialAssetInput, 0, len(request.InitialAssets))
	for _, item := range request.InitialAssets {
		if item == nil {
			return nil, errno.New(errno.ErrInvalidArgument)
		}
		initialAssets = append(initialAssets, applicationresource.InitialAssetInput{
			BlobID: item.BlobID, FileName: item.FileName, Name: item.Name,
		})
	}
	result, err := h.service.Create(ctx, applicationresource.CreateInput{
		Scope: scope, ProjectID: request.ProjectID, Type: domainresource.Type(request.Type),
		Name: request.Name, Description: stringValue(request.Description), InitialAssets: initialAssets,
	})
	if err != nil {
		return nil, err
	}
	dto, err := h.resourceDTO(ctx, scope, request.ProjectID, result.Resource)
	if err != nil {
		return nil, err
	}
	assets, err := h.batchAssets(ctx, scope, result.ResourceAssets)
	if err != nil {
		return nil, err
	}
	return &contractresource.CreateResourceResponse{
		Resource:       dto,
		ResourceAssets: resourceAssetDTOs(result.ResourceAssets, result.Resource.PrimaryResourceAssetID, assets),
	}, nil
}

func (h *ResourceHandler) CreateResourceFromAsset(ctx context.Context, request *contractresource.CreateResourceFromAssetRequest) (*contractresource.CreateResourceFromAssetResponse, error) {
	if err := requireAction(ctx, "CreateResourceFromAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	result, err := h.service.CreateFromAsset(ctx, applicationresource.CreateFromAssetInput{
		Scope: scope, ProjectID: request.ProjectID, AssetID: request.AssetID,
		Type: domainresource.Type(request.Type), Name: request.Name, Description: stringValue(request.Description),
		CanvasID: stringValue(request.CanvasID), CanvasNodeID: stringValue(request.CanvasNodeID),
	})
	if err != nil {
		return nil, err
	}
	resourceDTO, err := h.resourceDTO(ctx, scope, request.ProjectID, result.Resource)
	if err != nil {
		return nil, err
	}
	assets, err := h.batchAssets(ctx, scope, []domainresource.ResourceAsset{result.ResourceAsset})
	if err != nil {
		return nil, err
	}
	response := &contractresource.CreateResourceFromAssetResponse{
		Resource:      resourceDTO,
		ResourceAsset: resourceAssetDTO(result.ResourceAsset, true, assets[result.ResourceAsset.ID]),
	}
	if result.CanvasNodeBinding != nil {
		response.CanvasNodeBinding = &contractresource.CanvasNodeResourceAssetBinding{
			CanvasID: result.CanvasNodeBinding.CanvasID, CanvasNodeID: result.CanvasNodeBinding.CanvasNodeID,
			ResourceAssetID: result.CanvasNodeBinding.ResourceAssetID, CurrentAssetID: result.CanvasNodeBinding.CurrentAssetID,
			CanvasNodeRevision: result.CanvasNodeBinding.CanvasNodeRevision,
		}
	}
	return response, nil
}

func (h *ResourceHandler) UpdateResource(ctx context.Context, request *contractresource.UpdateResourceRequest) (*contractresource.UpdateResourceResponse, error) {
	if err := requireAction(ctx, "UpdateResource"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	current, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	name, description := current.Name, current.Description
	if request.Name != nil {
		name = *request.Name
	}
	if request.Description != nil {
		description = *request.Description
	}
	item, err := h.service.Update(ctx, applicationresource.UpdateInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID, Name: name, Description: description, ExpectedRevision: request.ExpectedRevision})
	if err != nil {
		return nil, err
	}
	dto, err := h.resourceDTO(ctx, scope, request.ProjectID, item)
	return &contractresource.UpdateResourceResponse{Resource: dto}, err
}

func (h *ResourceHandler) DeleteResource(ctx context.Context, request *contractresource.DeleteResourceRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "DeleteResource"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.Delete(ctx, applicationresource.DeleteInput{Scope: resourceScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, ResourceID: request.ResourceID, ExpectedRevision: request.ExpectedRevision}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ResourceHandler) BatchDeleteResources(ctx context.Context, request *contractresource.BatchDeleteResourcesRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "BatchDeleteResources"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	targets := make([]applicationresource.DeleteTarget, 0, len(request.Targets))
	for _, target := range request.Targets {
		if target != nil {
			targets = append(targets, applicationresource.DeleteTarget{ResourceID: target.ResourceID, ExpectedRevision: target.ExpectedRevision})
		}
	}
	if err := h.service.BatchDelete(ctx, applicationresource.BatchDeleteInput{Scope: resourceScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, Targets: targets}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ResourceHandler) ListResourceAssets(ctx context.Context, request *contractresource.ListResourceAssetsRequest) (*contractresource.ListResourceAssetsResponse, error) {
	if err := requireAction(ctx, "ListResourceAssets"); err != nil {
		return nil, err
	}
	if request.Page == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	parent, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	items, total, err := h.service.ListResourceAssets(ctx, applicationresource.ListResourceAssetsInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID, Page: applicationresource.Page{PageSize: int(request.Page.PageSize), PageNum: int(request.Page.PageNum)}})
	if err != nil {
		return nil, err
	}
	assets, err := h.batchAssets(ctx, scope, items)
	if err != nil {
		return nil, err
	}
	dtos := resourceAssetDTOs(items, parent.PrimaryResourceAssetID, assets)
	if err = h.attachGenerationStates(ctx, applicationresourceassetgeneration.Target{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID}, items, dtos); err != nil {
		return nil, err
	}
	return &contractresource.ListResourceAssetsResponse{Items: dtos, Page: pageOutput(request.Page.PageSize, request.Page.PageNum, total)}, nil
}

func (h *ResourceHandler) BatchGetResourceAssetGenerationStates(ctx context.Context, request *contractresource.BatchGetResourceAssetGenerationStatesRequest) (*contractresource.BatchGetResourceAssetGenerationStatesResponse, error) {
	if err := requireAction(ctx, "BatchGetResourceAssetGenerationStates"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	states, err := h.generations.BatchGetStates(ctx, applicationresourceassetgeneration.Target{Scope: resourceScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, ResourceID: request.ResourceID}, request.ResourceAssetIDs)
	if err != nil {
		return nil, err
	}
	items := make([]*contractresource.ResourceAssetGenerationState, 0, len(states))
	for _, state := range states {
		items = append(items, resourceAssetGenerationStateDTO(state))
	}
	return &contractresource.BatchGetResourceAssetGenerationStatesResponse{Items: items}, nil
}

func (h *ResourceHandler) attachGenerationStates(ctx context.Context, target applicationresourceassetgeneration.Target, assets []domainresource.ResourceAsset, dtos []*contractresource.ResourceAsset) error {
	ids := make([]string, 0, len(assets))
	for _, asset := range assets {
		if asset.ImageGenerationDraftID != "" {
			ids = append(ids, asset.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	states, err := h.generations.BatchGetStates(ctx, target, ids)
	if err != nil {
		return err
	}
	byID := make(map[string]*contractresource.ResourceAssetGenerationState, len(states))
	for _, state := range states {
		byID[state.ResourceAssetID] = resourceAssetGenerationStateDTO(state)
	}
	for _, dto := range dtos {
		dto.GenerationState = byID[dto.ResourceAssetID]
	}
	return nil
}

func (h *ResourceHandler) BatchListResourceAssets(ctx context.Context, request *contractresource.BatchListResourceAssetsRequest) (*contractresource.BatchListResourceAssetsResponse, error) {
	if err := requireAction(ctx, "BatchListResourceAssets"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	groups, err := h.service.BatchListResourceAssets(ctx, applicationresource.BatchListResourceAssetsInput{
		Scope: scope, ProjectID: request.ProjectID, ResourceIDs: request.ResourceIDs,
	})
	if err != nil {
		return nil, err
	}
	allItems := make([]domainresource.ResourceAsset, 0)
	for _, group := range groups {
		allItems = append(allItems, group.Items...)
	}
	assets, err := h.batchAssets(ctx, scope, allItems)
	if err != nil {
		return nil, err
	}
	responseGroups := make([]*contractresource.ResourceAssetGroup, 0, len(groups))
	for _, group := range groups {
		responseGroups = append(responseGroups, &contractresource.ResourceAssetGroup{
			ResourceID: group.Resource.ID,
			Items:      resourceAssetDTOs(group.Items, group.Resource.PrimaryResourceAssetID, assets),
		})
	}
	return &contractresource.BatchListResourceAssetsResponse{Groups: responseGroups}, nil
}

func (h *ResourceHandler) CreateResourceAsset(ctx context.Context, request *contractresource.CreateResourceAssetRequest) (*contractresource.CreateResourceAssetResponse, error) {
	if err := requireAction(ctx, "CreateResourceAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	item, err := h.service.CreateResourceAsset(ctx, applicationresource.CreateResourceAssetInput{
		Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID,
		AssetID: stringValue(request.AssetID), BlobID: stringValue(request.BlobID), FileName: stringValue(request.FileName),
		Name: request.Name, ExpectedResourceRevision: request.ExpectedResourceRevision,
	})
	if err != nil {
		return nil, err
	}
	assetItem, err := h.presignedAsset(ctx, scope, item.ID, item.CurrentAssetID)
	if err != nil {
		return nil, err
	}
	parent, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	return &contractresource.CreateResourceAssetResponse{ResourceAsset: resourceAssetDTO(item, isPrimaryResourceAsset(parent, item.ID), assetItem)}, nil
}

func (h *ResourceHandler) CreateGeneratedResourceAsset(ctx context.Context, request *contractresource.CreateGeneratedResourceAssetRequest) (*contractresource.CreateGeneratedResourceAssetResponse, error) {
	if err := requireAction(ctx, "CreateGeneratedResourceAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	item, _, err := h.service.CreateGeneratedResourceAsset(ctx, applicationresource.CreateGeneratedResourceAssetInput{
		Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID,
		ExpectedResourceRevision: request.ExpectedResourceRevision,
	})
	if err != nil {
		return nil, err
	}
	parent, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	return &contractresource.CreateGeneratedResourceAssetResponse{ResourceAsset: resourceAssetDTO(item, isPrimaryResourceAsset(parent, item.ID), applicationasset.PresignedReferencedAsset{})}, nil
}

func (h *ResourceHandler) ReplaceUploadedResourceAsset(ctx context.Context, request *contractresource.ReplaceUploadedResourceAssetRequest) (*contractresource.ReplaceUploadedResourceAssetResponse, error) {
	if err := requireAction(ctx, "ReplaceUploadedResourceAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	item, err := h.service.ReplaceUploadedResourceAsset(ctx, applicationresource.ReplaceUploadedResourceAssetInput{
		Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID, ResourceAssetID: request.ResourceAssetID,
		BlobID: request.BlobID, FileName: request.FileName,
		ExpectedResourceRevision: request.ExpectedResourceRevision, ExpectedResourceAssetRevision: request.ExpectedResourceAssetRevision,
	})
	if err != nil {
		return nil, err
	}
	assetItem, err := h.presignedAsset(ctx, scope, item.ID, item.CurrentAssetID)
	if err != nil {
		return nil, err
	}
	parent, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	return &contractresource.ReplaceUploadedResourceAssetResponse{ResourceAsset: resourceAssetDTO(item, isPrimaryResourceAsset(parent, item.ID), assetItem)}, nil
}

func (h *ResourceHandler) UpdateResourceAsset(ctx context.Context, request *contractresource.UpdateResourceAssetRequest) (*contractresource.UpdateResourceAssetResponse, error) {
	if err := requireAction(ctx, "UpdateResourceAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	item, err := h.service.RenameResourceAsset(ctx, applicationresource.RenameResourceAssetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID, ResourceAssetID: request.ResourceAssetID, Name: request.Name, ExpectedResourceRevision: request.ExpectedResourceRevision, ExpectedResourceAssetRevision: request.ExpectedResourceAssetRevision})
	if err != nil {
		return nil, err
	}
	assetItem, err := h.presignedAsset(ctx, scope, item.ID, item.CurrentAssetID)
	if err != nil {
		return nil, err
	}
	parent, err := h.service.Get(ctx, applicationresource.GetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID})
	if err != nil {
		return nil, err
	}
	return &contractresource.UpdateResourceAssetResponse{ResourceAsset: resourceAssetDTO(item, isPrimaryResourceAsset(parent, item.ID), assetItem)}, nil
}

func (h *ResourceHandler) SetPrimaryResourceAsset(ctx context.Context, request *contractresource.SetPrimaryResourceAssetRequest) (*contractresource.SetPrimaryResourceAssetResponse, error) {
	if err := requireAction(ctx, "SetPrimaryResourceAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	scope := resourceScope(ctx, request.WorkspaceID)
	item, err := h.service.SetPrimaryResourceAsset(ctx, applicationresource.SetPrimaryResourceAssetInput{Scope: scope, ProjectID: request.ProjectID, ResourceID: request.ResourceID, ResourceAssetID: request.ResourceAssetID, ExpectedResourceRevision: request.ExpectedResourceRevision})
	if err != nil {
		return nil, err
	}
	dto, err := h.resourceDTO(ctx, scope, request.ProjectID, item)
	return &contractresource.SetPrimaryResourceAssetResponse{Resource: dto}, err
}

func (h *ResourceHandler) DeleteResourceAsset(ctx context.Context, request *contractresource.DeleteResourceAssetRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "DeleteResourceAsset"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.DeleteResourceAsset(ctx, applicationresource.DeleteResourceAssetInput{Scope: resourceScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, ResourceID: request.ResourceID, ResourceAssetID: request.ResourceAssetID, ExpectedResourceRevision: request.ExpectedResourceRevision, ExpectedResourceAssetRevision: request.ExpectedResourceAssetRevision}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ResourceHandler) BatchDeleteResourceAssets(ctx context.Context, request *contractresource.BatchDeleteResourceAssetsRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "BatchDeleteResourceAssets"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	targets := make([]applicationresource.DeleteResourceAssetTarget, 0, len(request.Targets))
	for _, target := range request.Targets {
		if target != nil {
			targets = append(targets, applicationresource.DeleteResourceAssetTarget{
				ResourceAssetID:               target.ResourceAssetID,
				ExpectedResourceRevision:      target.ExpectedResourceRevision,
				ExpectedResourceAssetRevision: target.ExpectedResourceAssetRevision,
			})
		}
	}
	err := h.service.BatchDeleteResourceAssets(ctx, applicationresource.BatchDeleteResourceAssetsInput{
		Scope: resourceScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
		ResourceID: request.ResourceID, Targets: targets,
	})
	if err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ResourceHandler) GetResourceAssetGeneration(ctx context.Context, request *contractresource.GetResourceAssetGenerationRequest) (*contractresource.GetResourceAssetGenerationResponse, error) {
	if err := requireAction(ctx, "GetResourceAssetGeneration"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.generations.Get(ctx, applicationresourceassetgeneration.GetInput{Target: resourceAssetGenerationTarget(ctx, request.WorkspaceID, request.ProjectID, request.ResourceID, request.ResourceAssetID)})
	if err != nil {
		return nil, err
	}
	return &contractresource.GetResourceAssetGenerationResponse{Generation: resourceAssetGenerationDTO(item)}, nil
}

func (h *ResourceHandler) UpdateResourceAssetGeneration(ctx context.Context, request *contractresource.UpdateResourceAssetGenerationRequest) (*contractresource.UpdateResourceAssetGenerationResponse, error) {
	if err := requireAction(ctx, "UpdateResourceAssetGeneration"); err != nil {
		return nil, err
	}
	if request.Patch == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	request.Top = topParam(ctx)
	patch, err := resourceAssetGenerationPatch(request.Patch)
	if err != nil {
		return nil, err
	}
	item, err := h.generations.Update(ctx, applicationresourceassetgeneration.UpdateInput{
		Target: resourceAssetGenerationTarget(ctx, request.WorkspaceID, request.ProjectID, request.ResourceID, request.ResourceAssetID),
		Patch:  patch, ExpectedRevision: request.ExpectedRevision,
	})
	if err != nil {
		return nil, err
	}
	return &contractresource.UpdateResourceAssetGenerationResponse{Generation: resourceAssetGenerationDTO(item)}, nil
}

func (h *ResourceHandler) StartResourceAssetGeneration(ctx context.Context, request *contractresource.StartResourceAssetGenerationRequest) (*contractresource.StartResourceAssetGenerationResponse, error) {
	if err := requireAction(ctx, "StartResourceAssetGeneration"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	result, err := h.generations.Start(ctx, applicationresourceassetgeneration.StartInput{
		Target:           resourceAssetGenerationTarget(ctx, request.WorkspaceID, request.ProjectID, request.ResourceID, request.ResourceAssetID),
		ExpectedRevision: request.ExpectedRevision,
	})
	if err != nil {
		return nil, err
	}
	return &contractresource.StartResourceAssetGenerationResponse{TaskRunID: result.TaskRunID}, nil
}

func (h *ResourceHandler) CancelResourceAssetGeneration(ctx context.Context, request *contractresource.CancelResourceAssetGenerationRequest) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "CancelResourceAssetGeneration"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.generations.Cancel(ctx, applicationresourceassetgeneration.CancelInput{
		Target:    resourceAssetGenerationTarget(ctx, request.WorkspaceID, request.ProjectID, request.ResourceID, request.ResourceAssetID),
		TaskRunID: request.TaskRunID,
	}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ResourceHandler) GetResourceAssetGenerationRun(ctx context.Context, request *contractresource.GetResourceAssetGenerationRunRequest) (*contractresource.GetResourceAssetGenerationRunResponse, error) {
	if err := requireAction(ctx, "GetResourceAssetGenerationRun"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.generations.GetRun(ctx, applicationresourceassetgeneration.GetRunInput{
		Target:    resourceAssetGenerationTarget(ctx, request.WorkspaceID, request.ProjectID, request.ResourceID, request.ResourceAssetID),
		TaskRunID: request.TaskRunID,
	})
	if err != nil {
		return nil, err
	}
	return &contractresource.GetResourceAssetGenerationRunResponse{Run: resourceAssetGenerationRunDTO(item)}, nil
}

func resourceScope(ctx context.Context, workspaceID *string) applicationresource.Scope {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return applicationresource.Scope{TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(workspaceID), CallerID: metadata.UserID}
}

func resourceAssetGenerationTarget(ctx context.Context, workspaceID *string, projectID, resourceID, resourceAssetID string) applicationresourceassetgeneration.Target {
	return applicationresourceassetgeneration.Target{Scope: resourceScope(ctx, workspaceID), ProjectID: projectID, ResourceID: resourceID, ResourceAssetID: resourceAssetID}
}
func assetReadScope(scope applicationresource.Scope) applicationasset.Scope {
	return applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}
}

func (h *ResourceHandler) presignedAsset(ctx context.Context, scope applicationresource.Scope, resourceAssetID, assetID string) (applicationasset.PresignedReferencedAsset, error) {
	if assetID == "" {
		return applicationasset.PresignedReferencedAsset{}, nil
	}
	reference := applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: resourceAssetID}, AssetID: assetID}
	items, err := h.assets.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{Scope: assetReadScope(scope), References: []applicationasset.AssetReference{reference}})
	if err != nil {
		return applicationasset.PresignedReferencedAsset{}, err
	}
	if len(items) != 1 || items[0].Reference != reference {
		return applicationasset.PresignedReferencedAsset{}, errno.New(errno.ErrInternalError)
	}
	return items[0], nil
}

func (h *ResourceHandler) batchAssets(ctx context.Context, scope applicationresource.Scope, items []domainresource.ResourceAsset) (map[string]applicationasset.PresignedReferencedAsset, error) {
	references := make([]applicationasset.AssetReference, 0, len(items))
	for _, item := range items {
		if item.CurrentAssetID != "" {
			references = append(references, applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: item.ID}, AssetID: item.CurrentAssetID})
		}
	}
	if len(references) == 0 {
		return map[string]applicationasset.PresignedReferencedAsset{}, nil
	}
	found, err := h.assets.BatchPresignReferencedAssets(ctx, applicationasset.BatchGetReferencedAssetsInput{Scope: assetReadScope(scope), References: references})
	if err != nil {
		return nil, err
	}
	result := make(map[string]applicationasset.PresignedReferencedAsset, len(found))
	for _, item := range found {
		result[item.Reference.Owner.Key] = item
	}
	for _, item := range items {
		if item.CurrentAssetID == "" {
			continue
		}
		if _, ok := result[item.ID]; !ok {
			return nil, errno.New(errno.ErrInternalError)
		}
	}
	return result, nil
}

func isPrimaryResourceAsset(parent domainresource.Resource, resourceAssetID string) bool {
	return parent.PrimaryResourceAssetID != nil && *parent.PrimaryResourceAssetID == resourceAssetID
}
func baseResourceDTO(item domainresource.Resource) *contractresource.Resource {
	return &contractresource.Resource{ResourceID: item.ID, ProjectID: item.OwnerID, Type: contractresource.ResourceType(item.Type), Name: item.Name, Description: item.Description, ResourceAssetCount: item.ResourceAssetCount, Revision: item.Revision, CreatedBy: item.CreatedBy, CreatedAt: timestamp(item.CreatedAt), UpdatedAt: timestamp(item.UpdatedAt), OwnerType: contractresource.ResourceOwnerType(item.OwnerType), ApprovedResourceAssetCount: item.ApprovedResourceAssetCount}
}

func (h *ResourceHandler) resourceDTOs(ctx context.Context, scope applicationresource.Scope, projectID string, items []domainresource.Resource) ([]*contractresource.Resource, error) {
	primaryIDs := make([]string, 0, len(items))
	for _, item := range items {
		if item.PrimaryResourceAssetID != nil {
			primaryIDs = append(primaryIDs, *item.PrimaryResourceAssetID)
		}
	}
	bindings, err := h.service.BatchGetResourceAssets(ctx, applicationresource.BatchGetResourceAssetsInput{Scope: scope, ProjectID: projectID, ResourceAssetIDs: primaryIDs})
	if err != nil {
		return nil, err
	}
	assets, err := h.batchAssets(ctx, scope, bindings)
	if err != nil {
		return nil, err
	}
	bindingsByID := make(map[string]domainresource.ResourceAsset, len(bindings))
	for _, binding := range bindings {
		bindingsByID[binding.ID] = binding
	}
	result := make([]*contractresource.Resource, 0, len(items))
	for _, item := range items {
		dto := baseResourceDTO(item)
		if item.PrimaryResourceAssetID != nil {
			binding, ok := bindingsByID[*item.PrimaryResourceAssetID]
			if !ok {
				return nil, errno.New(errno.ErrInternalError)
			}
			current := assets[binding.ID]
			dto.PrimaryResourceAsset = &contractresource.ResourceAssetSummary{ResourceAssetID: binding.ID, Name: binding.Name, CurrentAssetID: optionalString(binding.CurrentAssetID), PreviewURL: optionalString(current.URL), ExpiresAt: previewExpiresAt(current.URL, current.ExpiresAt), MediaType: contractasset.AssetMediaType(binding.MediaType), SourceType: contractresource.ResourceAssetSourceType(binding.SourceType), Reviews: reviewsFromPresigned(current)}
		}
		result = append(result, dto)
	}
	return result, nil
}

func (h *ResourceHandler) resourceDTO(ctx context.Context, scope applicationresource.Scope, projectID string, item domainresource.Resource) (*contractresource.Resource, error) {
	dto := baseResourceDTO(item)
	if item.PrimaryResourceAssetID == nil {
		return dto, nil
	}
	binding, err := h.service.GetResourceAsset(ctx, applicationresource.GetResourceAssetInput{Scope: scope, ProjectID: projectID, ResourceID: item.ID, ResourceAssetID: *item.PrimaryResourceAssetID})
	if err != nil {
		return nil, err
	}
	assetItem, err := h.presignedAsset(ctx, scope, binding.ID, binding.CurrentAssetID)
	if err != nil {
		return nil, err
	}
	dto.PrimaryResourceAsset = &contractresource.ResourceAssetSummary{ResourceAssetID: binding.ID, Name: binding.Name, CurrentAssetID: optionalString(binding.CurrentAssetID), PreviewURL: optionalString(assetItem.URL), ExpiresAt: previewExpiresAt(assetItem.URL, assetItem.ExpiresAt), MediaType: contractasset.AssetMediaType(binding.MediaType), SourceType: contractresource.ResourceAssetSourceType(binding.SourceType), Reviews: reviewsFromPresigned(assetItem)}
	return dto, nil
}
func resourceAssetDTOs(items []domainresource.ResourceAsset, primaryID *string, assets map[string]applicationasset.PresignedReferencedAsset) []*contractresource.ResourceAsset {
	result := make([]*contractresource.ResourceAsset, 0, len(items))
	for _, item := range items {
		isPrimary := primaryID != nil && *primaryID == item.ID
		result = append(result, resourceAssetDTO(item, isPrimary, assets[item.ID]))
	}
	return result
}
func resourceAssetDTO(item domainresource.ResourceAsset, isPrimary bool, current applicationasset.PresignedReferencedAsset) *contractresource.ResourceAsset {
	return &contractresource.ResourceAsset{ResourceAssetID: item.ID, ResourceID: item.ResourceID, Name: item.Name, SequenceNo: item.SequenceNo, CurrentAssetID: optionalString(item.CurrentAssetID), IsPrimary: isPrimary, Revision: item.Revision, CreatedAt: timestamp(item.CreatedAt), UpdatedAt: timestamp(item.UpdatedAt), PreviewURL: optionalString(current.URL), ExpiresAt: previewExpiresAt(current.URL, current.ExpiresAt), MediaType: contractasset.AssetMediaType(item.MediaType), SourceType: contractresource.ResourceAssetSourceType(item.SourceType), Reviews: reviewsFromPresigned(current)}
}

func reviewsFromPresigned(current applicationasset.PresignedReferencedAsset) []*contractasset.AssetReview {
	return assetReviewDTOs(current.Asset.Reviews)
}

func resourceAssetGenerationDTO(item applicationresourceassetgeneration.Generation) *contractresource.ResourceAssetGeneration {
	uploaded := make([]*contractresource.ResourceAssetGenerationUploadedReference, 0, len(item.UploadedReferences))
	for _, reference := range item.UploadedReferences {
		uploaded = append(uploaded, &contractresource.ResourceAssetGenerationUploadedReference{AssetID: reference.AssetID, FileName: reference.FileName, PreviewURL: optionalString(reference.PreviewURL)})
	}
	resources := make([]*contractresource.ResourceAssetGenerationResourceReference, 0, len(item.ResourceReferences))
	for _, reference := range item.ResourceReferences {
		resources = append(resources, &contractresource.ResourceAssetGenerationResourceReference{ResourceID: reference.ResourceID, SequenceNo: reference.SequenceNo})
	}
	result := &contractresource.ResourceAssetGeneration{
		Prompt: item.Prompt, ModelID: item.ModelID, Resolution: resourceAssetGenerationResolutionDTO(item.Resolution),
		AspectRatio: resourceAssetGenerationAspectRatioDTO(item.AspectRatio), Watermark: item.Watermark,
		UploadedReferences: uploaded, ResourceReferences: resources, Revision: item.Revision,
		ActiveTaskRunID: optionalString(item.ActiveTaskRunID),
	}
	if item.LatestRun != nil {
		result.LatestRun = resourceAssetGenerationRunDTO(*item.LatestRun)
	}
	return result
}

func resourceAssetGenerationStateDTO(item applicationresourceassetgeneration.GenerationState) *contractresource.ResourceAssetGenerationState {
	return &contractresource.ResourceAssetGenerationState{ResourceAssetID: item.ResourceAssetID, TaskRunID: item.Run.TaskRunID, Status: resourceAssetGenerationRunStatusDTO(item.Run.Status), ErrorCode: optionalString(item.Run.ErrorCode), ErrorMessage: optionalString(item.Run.ErrorMessage)}
}

func resourceAssetGenerationPatch(patch *contractresource.ResourceAssetGenerationPatch) (applicationresourceassetgeneration.GenerationPatch, error) {
	result := applicationresourceassetgeneration.GenerationPatch{Config: domainimagegeneration.ConfigPatch{Prompt: patch.Prompt, ModelID: patch.ModelID, Watermark: patch.Watermark}}
	if patch.Resolution != nil {
		value := resourceAssetGenerationResolution(*patch.Resolution)
		result.Config.Resolution = &value
	}
	if patch.AspectRatio != nil {
		value := resourceAssetGenerationAspectRatio(*patch.AspectRatio)
		result.Config.AspectRatio = &value
	}
	if patch.UploadedReferences != nil {
		references := make([]applicationresourceassetgeneration.UploadedReferenceInput, 0, len(patch.UploadedReferences))
		for _, reference := range patch.UploadedReferences {
			if reference == nil {
				return applicationresourceassetgeneration.GenerationPatch{}, errno.New(errno.ErrInvalidArgument)
			}
			assetID := strings.TrimSpace(reference.GetAssetID())
			blobID := strings.TrimSpace(reference.GetBlobID())
			fileName := strings.TrimSpace(reference.GetFileName())
			if (assetID == "") == (blobID == "") || (blobID != "" && fileName == "") || (assetID != "" && fileName != "") {
				return applicationresourceassetgeneration.GenerationPatch{}, errno.New(errno.ErrInvalidArgument)
			}
			references = append(references, applicationresourceassetgeneration.UploadedReferenceInput{
				AssetID: assetID, BlobID: blobID, FileName: fileName,
			})
		}
		result.UploadedReferences = &references
	}
	if patch.ResourceReferences != nil {
		references := make([]domainresourceassetgeneration.ResourceReference, 0, len(patch.ResourceReferences))
		for _, reference := range patch.ResourceReferences {
			if reference == nil {
				return applicationresourceassetgeneration.GenerationPatch{}, errno.New(errno.ErrInvalidArgument)
			}
			references = append(references, domainresourceassetgeneration.ResourceReference{ResourceID: reference.ResourceID, SequenceNo: reference.SequenceNo})
		}
		result.ResourceReferences = &references
	}
	return result, nil
}

func resourceAssetGenerationRunDTO(item applicationresourceassetgeneration.Run) *contractresource.ResourceAssetGenerationRun {
	inputs := make([]*contractresource.ResourceAssetGenerationRunInput, 0, len(item.Inputs))
	for _, input := range item.Inputs {
		inputs = append(inputs, &contractresource.ResourceAssetGenerationRunInput{Position: input.Position, SourceType: resourceAssetGenerationInputSourceDTO(input.SourceType), AssetID: input.AssetID})
	}
	resolution := resourceAssetGenerationResolutionDTO(item.Resolution)
	aspectRatio := resourceAssetGenerationAspectRatioDTO(item.AspectRatio)
	result := &contractresource.ResourceAssetGenerationRun{
		TaskRunID: item.TaskRunID, Status: resourceAssetGenerationRunStatusDTO(item.Status), Prompt: item.Prompt, ModelID: item.ModelID,
		Watermark: item.Watermark,
		Inputs:    inputs, OutputAssetID: optionalString(item.OutputAssetID), ErrorCode: optionalString(item.ErrorCode), ErrorMessage: optionalString(item.ErrorMessage),
		StartedAt: optionalTimestamp(item.StartedAt), FinishedAt: optionalTimestamp(item.FinishedAt), CreatedAt: timestamp(item.CreatedAt), UpdatedAt: timestamp(item.UpdatedAt),
	}
	if resolution != nil {
		result.Resolution = *resolution
	}
	if aspectRatio != nil {
		result.AspectRatio = *aspectRatio
	}
	return result
}

func resourceAssetGenerationResolution(value contractresource.ResourceAssetGenerationResolution) domainimagegeneration.Resolution {
	switch value {
	case contractresource.ResourceAssetGenerationResolution_RESOLUTION_480P:
		return domainimagegeneration.Resolution480P
	case contractresource.ResourceAssetGenerationResolution_RESOLUTION_720P:
		return domainimagegeneration.Resolution720P
	case contractresource.ResourceAssetGenerationResolution_RESOLUTION_1080P:
		return domainimagegeneration.Resolution1080P
	case contractresource.ResourceAssetGenerationResolution_RESOLUTION_2K:
		return domainimagegeneration.Resolution2K
	case contractresource.ResourceAssetGenerationResolution_RESOLUTION_4K:
		return domainimagegeneration.Resolution4K
	default:
		return ""
	}
}

func resourceAssetGenerationResolutionDTO(value domainimagegeneration.Resolution) *contractresource.ResourceAssetGenerationResolution {
	var result contractresource.ResourceAssetGenerationResolution
	switch value {
	case domainimagegeneration.Resolution480P:
		result = contractresource.ResourceAssetGenerationResolution_RESOLUTION_480P
	case domainimagegeneration.Resolution720P:
		result = contractresource.ResourceAssetGenerationResolution_RESOLUTION_720P
	case domainimagegeneration.Resolution1080P:
		result = contractresource.ResourceAssetGenerationResolution_RESOLUTION_1080P
	case domainimagegeneration.Resolution2K:
		result = contractresource.ResourceAssetGenerationResolution_RESOLUTION_2K
	case domainimagegeneration.Resolution4K:
		result = contractresource.ResourceAssetGenerationResolution_RESOLUTION_4K
	default:
		return nil
	}
	return &result
}

func resourceAssetGenerationAspectRatio(value contractresource.ResourceAssetGenerationAspectRatio) domainimagegeneration.AspectRatio {
	switch value {
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_1_1:
		return domainimagegeneration.AspectRatio1x1
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_3_4:
		return domainimagegeneration.AspectRatio3x4
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_4_3:
		return domainimagegeneration.AspectRatio4x3
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_9_16:
		return domainimagegeneration.AspectRatio9x16
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_16_9:
		return domainimagegeneration.AspectRatio16x9
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_3_2:
		return domainimagegeneration.AspectRatio3x2
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_2_3:
		return domainimagegeneration.AspectRatio2x3
	case contractresource.ResourceAssetGenerationAspectRatio_RATIO_21_9:
		return domainimagegeneration.AspectRatio21x9
	default:
		return ""
	}
}

func resourceAssetGenerationAspectRatioDTO(value domainimagegeneration.AspectRatio) *contractresource.ResourceAssetGenerationAspectRatio {
	var result contractresource.ResourceAssetGenerationAspectRatio
	switch value {
	case domainimagegeneration.AspectRatio1x1:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_1_1
	case domainimagegeneration.AspectRatio3x4:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_3_4
	case domainimagegeneration.AspectRatio4x3:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_4_3
	case domainimagegeneration.AspectRatio9x16:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_9_16
	case domainimagegeneration.AspectRatio16x9:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_16_9
	case domainimagegeneration.AspectRatio3x2:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_3_2
	case domainimagegeneration.AspectRatio2x3:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_2_3
	case domainimagegeneration.AspectRatio21x9:
		result = contractresource.ResourceAssetGenerationAspectRatio_RATIO_21_9
	default:
		return nil
	}
	return &result
}

func resourceAssetGenerationRunStatusDTO(value domaintask.Status) contractresource.ResourceAssetGenerationRunStatus {
	switch value {
	case domaintask.StatusQueued:
		return contractresource.ResourceAssetGenerationRunStatus_QUEUED
	case domaintask.StatusRunning:
		return contractresource.ResourceAssetGenerationRunStatus_RUNNING
	case domaintask.StatusSucceeded:
		return contractresource.ResourceAssetGenerationRunStatus_SUCCEEDED
	case domaintask.StatusFailed:
		return contractresource.ResourceAssetGenerationRunStatus_FAILED
	case domaintask.StatusCancelled:
		return contractresource.ResourceAssetGenerationRunStatus_CANCELLED
	default:
		return 0
	}
}

func resourceAssetGenerationInputSourceDTO(value applicationresourceassetgeneration.RunInputSource) contractresource.ResourceAssetGenerationInputSourceType {
	if value == applicationresourceassetgeneration.RunInputUploaded {
		return contractresource.ResourceAssetGenerationInputSourceType_UPLOADED
	}
	if value == applicationresourceassetgeneration.RunInputResource {
		return contractresource.ResourceAssetGenerationInputSourceType_RESOURCE_ASSET
	}
	return 0
}

func optionalTimestamp(value *time.Time) *contractcommon.Timestamp {
	if value == nil {
		return nil
	}
	result := timestamp(*value)
	return &result
}

func resourceTypePointer(value *contractresource.ResourceType) *domainresource.Type {
	if value == nil {
		return nil
	}
	result := domainresource.Type(*value)
	return &result
}
func resourceSort(sort *contractresource.ResourceSort) (applicationresource.SortField, applicationresource.SortDirection, error) {
	if sort == nil {
		return applicationresource.SortUnspecified, applicationresource.SortDirectionUnspecified, nil
	}
	field := applicationresource.SortUnspecified
	if sort.IsSetField() {
		switch sort.GetField() {
		case contractresource.ResourceSortField_CREATED_AT:
			field = applicationresource.SortCreatedAt
		case contractresource.ResourceSortField_UPDATED_AT:
			field = applicationresource.SortUpdatedAt
		default:
			return applicationresource.SortUnspecified, applicationresource.SortDirectionUnspecified, errno.New(errno.ErrInvalidArgument)
		}
	}
	direction := applicationresource.SortDirectionUnspecified
	if sort.IsSetDirection() {
		switch sort.GetDirection() {
		case contractcommon.SortDirection_ASC:
			direction = applicationresource.SortAscending
		case contractcommon.SortDirection_DESC:
			direction = applicationresource.SortDescending
		default:
			return applicationresource.SortUnspecified, applicationresource.SortDirectionUnspecified, errno.New(errno.ErrInvalidArgument)
		}
	}
	return field, direction, nil
}
func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
