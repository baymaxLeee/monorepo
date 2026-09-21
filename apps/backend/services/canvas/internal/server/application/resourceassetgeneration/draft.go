package resourceassetgeneration

import (
	"context"
	"errors"
	"strings"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/server/application/imagegeneration"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/server/domain/imagegeneration"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/server/domain/resourceassetgeneration"
)

type DraftService struct {
	drafts         DraftRepository
	assets         DraftAssetReader
	materializer   DraftAssetMaterializer
	resourceAssets DraftResourceAssetStore
	transactions   DraftTransactionManager
	references     DraftAssetReferenceTracker
	clock          DraftClock
}

type DraftServiceOption func(*DraftService)

func WithDraftAssetMaterializer(materializer DraftAssetMaterializer) DraftServiceOption {
	return func(service *DraftService) { service.materializer = materializer }
}

func NewDraftService(drafts DraftRepository, assets DraftAssetReader, resourceAssets DraftResourceAssetStore, transactions DraftTransactionManager, references DraftAssetReferenceTracker, clock DraftClock, options ...DraftServiceOption) *DraftService {
	service := &DraftService{drafts: drafts, assets: assets, resourceAssets: resourceAssets, transactions: transactions, references: references, clock: clock}
	for _, option := range options {
		option(service)
	}
	return service
}

type UploadedReferenceInput struct {
	AssetID  string
	BlobID   string
	FileName string
}

type DraftPatch struct {
	Config             domainimagegeneration.ConfigPatch
	UploadedReferences *[]UploadedReferenceInput
	ResourceReferences *[]domainresourceassetgeneration.ResourceReference
}

type DraftGetInput struct {
	Scope   DraftScope
	DraftID string
}

type DraftUpdateInput struct {
	Scope            DraftScope
	ProjectID        string
	DraftID          string
	Patch            DraftPatch
	ExpectedRevision int64
}

func (service *DraftService) Get(ctx context.Context, input DraftGetInput) (domainresourceassetgeneration.Draft, error) {
	if service == nil || service.drafts == nil || !validDraftScope(input.Scope) || strings.TrimSpace(input.DraftID) == "" {
		return domainresourceassetgeneration.Draft{}, domainresourceassetgeneration.ErrInvalidDraft
	}
	return service.drafts.Get(ctx, input.Scope, input.DraftID)
}

func (service *DraftService) Update(ctx context.Context, input DraftUpdateInput) (domainresourceassetgeneration.Draft, error) {
	if service == nil || service.drafts == nil || service.assets == nil || service.resourceAssets == nil || service.transactions == nil || service.clock == nil ||
		!validDraftScope(input.Scope) || strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.DraftID) == "" || input.ExpectedRevision < 1 {
		return domainresourceassetgeneration.Draft{}, domainresourceassetgeneration.ErrInvalidDraft
	}
	domainPatch := domainresourceassetgeneration.DraftPatch{
		Config: input.Patch.Config, ResourceReferences: input.Patch.ResourceReferences,
	}
	createdAssets := []domainasset.Asset(nil)
	if input.Patch.UploadedReferences != nil {
		var err error
		domainPatch.UploadedReferences, createdAssets, err = service.materializeUploadedReferences(ctx, input)
		if err != nil {
			return domainresourceassetgeneration.Draft{}, err
		}
	}
	var updated domainresourceassetgeneration.Draft
	var delta ReferenceDelta
	err := service.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if len(createdAssets) > 0 {
			if err := service.materializer.PersistPreparedCreates(txCtx, createdAssets); err != nil {
				return err
			}
		}
		var err error
		updated, err = service.drafts.GetForUpdate(txCtx, input.Scope, input.DraftID)
		if err != nil {
			return err
		}
		if updated.Revision != input.ExpectedRevision {
			return ErrDraftRevisionConflict
		}
		target, err := service.resourceAssets.GetResourceAssetForUpdate(txCtx, updated.ResourceID, updated.ResourceAssetID)
		if err != nil {
			if errors.Is(err, applicationresource.ErrResourceAssetNotFound) {
				return ErrDraftReferenceInvalid
			}
			return err
		}
		if !matchesDraftTarget(target, updated) {
			return ErrDraftReferenceInvalid
		}
		changed, err := updated.Update(domainPatch, input.ExpectedRevision, service.clock.Now())
		if err != nil {
			if errors.Is(err, domainresourceassetgeneration.ErrRevisionConflict) {
				return ErrDraftRevisionConflict
			}
			return err
		}
		if !changed {
			return nil
		}
		validator := TargetHandler{assets: service.assets, resourceAssets: service.resourceAssets}
		_, err = validator.resolveInputs(txCtx, applicationimagegeneration.Scope{
			TenantID: input.Scope.TenantID, WorkspaceID: input.Scope.WorkspaceID, CallerID: input.Scope.CallerID,
		}, updated, target)
		if err != nil {
			return err
		}
		delta, err = service.drafts.Update(txCtx, updated, input.ExpectedRevision)
		if err != nil || service.references == nil {
			return err
		}
		scope := applicationasset.ReferenceScope{TenantID: input.Scope.TenantID, WorkspaceID: input.Scope.WorkspaceID}
		owner := applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetGenerationUpload, Key: updated.ID}
		if len(delta.AddedAssetIDs) > 0 {
			if err = service.references.AcquireAssets(txCtx, applicationasset.AcquireAssetsInput{Scope: scope, Owner: owner, AssetIDs: delta.AddedAssetIDs}); err != nil {
				return err
			}
		}
		if len(delta.RemovedAssetIDs) > 0 {
			return service.references.ReleaseAssets(txCtx, applicationasset.ReleaseAssetsInput{Scope: scope, Owner: owner, AssetIDs: delta.RemovedAssetIDs})
		}
		return nil
	})
	if err != nil {
		if len(createdAssets) > 0 {
			err = service.materializer.CompensateCreatedMany(ctx, createdAssets, err)
		}
		return domainresourceassetgeneration.Draft{}, err
	}
	return updated, nil
}

func (service *DraftService) materializeUploadedReferences(ctx context.Context, input DraftUpdateInput) (*[]domainresourceassetgeneration.UploadedReference, []domainasset.Asset, error) {
	references := *input.Patch.UploadedReferences
	normalized := make([]domainresourceassetgeneration.UploadedReference, len(references))
	prepareItems := make([]applicationasset.PrepareCreateItem, 0, len(references))
	for index, reference := range references {
		assetID := strings.TrimSpace(reference.AssetID)
		blobID := strings.TrimSpace(reference.BlobID)
		fileName := strings.TrimSpace(reference.FileName)
		if (assetID == "") == (blobID == "") || (blobID != "" && fileName == "") || (assetID != "" && fileName != "") {
			return nil, nil, ErrDraftReferenceInvalid
		}
		if assetID != "" {
			normalized[index] = domainresourceassetgeneration.UploadedReference{AssetID: assetID}
			continue
		}
		prepareItems = append(prepareItems, applicationasset.PrepareCreateItem{BlobID: blobID, FileName: fileName})
	}
	if len(prepareItems) == 0 {
		return &normalized, nil, nil
	}
	if service.materializer == nil {
		return nil, nil, ErrDraftReferenceInvalid
	}
	draft, err := service.drafts.Get(ctx, input.Scope, input.DraftID)
	if err != nil {
		return nil, nil, err
	}
	if draft.Revision != input.ExpectedRevision {
		return nil, nil, ErrDraftRevisionConflict
	}
	prepared, err := service.materializer.PrepareResourceOwnedCreates(ctx, applicationasset.Scope{
		TenantID: input.Scope.TenantID, WorkspaceID: input.Scope.WorkspaceID, CallerID: input.Scope.CallerID,
	}, &input.ProjectID, draft.ResourceID, prepareItems)
	if err != nil {
		return nil, nil, err
	}
	if len(prepared) != len(prepareItems) {
		return nil, nil, ErrDraftReferenceInvalid
	}
	for _, item := range prepared {
		if item.MediaType != domainasset.MediaImage {
			return nil, nil, ErrDraftReferenceInvalid
		}
	}
	created, err := service.materializer.RegisterPreparedCreates(ctx, prepared)
	if err != nil {
		return nil, nil, err
	}
	if len(created) != len(prepared) {
		return nil, nil, service.materializer.CompensateCreatedMany(ctx, created, ErrDraftReferenceInvalid)
	}
	createdIndex := 0
	for index, reference := range references {
		if strings.TrimSpace(reference.AssetID) != "" {
			continue
		}
		normalized[index] = domainresourceassetgeneration.UploadedReference{AssetID: created[createdIndex].ID}
		createdIndex++
	}
	return &normalized, created, nil
}

func validDraftScope(scope DraftScope) bool {
	return strings.TrimSpace(scope.TenantID) != "" && strings.TrimSpace(scope.CallerID) != ""
}
