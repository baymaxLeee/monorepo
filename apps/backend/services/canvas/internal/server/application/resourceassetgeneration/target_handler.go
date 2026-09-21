package resourceassetgeneration

import (
	"context"
	"errors"

	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/server/application/imagegeneration"
	applicationresource "github.com/example/monorepo/canvas/internal/server/application/resource"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/server/domain/imagegeneration"
	domainresource "github.com/example/monorepo/canvas/internal/server/domain/resource"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/server/domain/resourceassetgeneration"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type TargetHandler struct {
	drafts         DraftRepository
	assets         DraftAssetReader
	resourceAssets DraftResourceAssetStore
	reviewCleanup  DraftReviewCleanup
	references     DraftAssetReferenceTracker
}

type TargetHandlerOption func(*TargetHandler)

func WithTargetReviewCleanup(cleanup DraftReviewCleanup) TargetHandlerOption {
	return func(handler *TargetHandler) { handler.reviewCleanup = cleanup }
}

func WithTargetAssetReferences(references DraftAssetReferenceTracker) TargetHandlerOption {
	return func(handler *TargetHandler) { handler.references = references }
}

func NewTargetHandler(drafts DraftRepository, assets DraftAssetReader, resourceAssets DraftResourceAssetStore, options ...TargetHandlerOption) *TargetHandler {
	handler := &TargetHandler{drafts: drafts, assets: assets, resourceAssets: resourceAssets}
	for _, option := range options {
		option(handler)
	}
	return handler
}

func (*TargetHandler) TargetType() domainimagegeneration.TargetType {
	return domainimagegeneration.TargetResourceAsset
}

func (handler *TargetHandler) PrepareStart(ctx context.Context, target applicationimagegeneration.StartTarget, taskRunID string) (domainimagegeneration.RunSpec, error) {
	if handler == nil || handler.drafts == nil || handler.assets == nil || handler.resourceAssets == nil || target.TargetType != handler.TargetType() {
		return domainimagegeneration.RunSpec{}, domainimagegeneration.ErrInvalidGeneration
	}
	scope := draftScope(target.Scope)
	draft, err := handler.drafts.GetForUpdate(ctx, scope, target.TargetID)
	if err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	if draft.Revision != target.ExpectedRevision {
		return domainimagegeneration.RunSpec{}, ErrDraftRevisionConflict
	}
	if draft.ActiveTaskRunID != "" {
		return domainimagegeneration.RunSpec{}, ErrDraftRunActive
	}
	if !draft.Ready() {
		return domainimagegeneration.RunSpec{}, ErrDraftConfigIncomplete
	}
	targetSlot, err := handler.resourceAssets.GetResourceAssetForUpdate(ctx, draft.ResourceID, draft.ResourceAssetID)
	if err != nil {
		if errors.Is(err, applicationresource.ErrResourceAssetNotFound) {
			return domainimagegeneration.RunSpec{}, ErrDraftReferenceInvalid
		}
		return domainimagegeneration.RunSpec{}, err
	}
	if !matchesDraftTarget(targetSlot, draft) {
		return domainimagegeneration.RunSpec{}, ErrDraftReferenceInvalid
	}
	inputs, err := handler.resolveInputs(ctx, target.Scope, draft, targetSlot)
	if err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	won, err := handler.drafts.SetActiveTaskRun(ctx, scope, draft.ID, taskRunID)
	if err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	if !won {
		return domainimagegeneration.RunSpec{}, ErrDraftRunActive
	}
	return domainimagegeneration.RunSpec{
		Target: domainimagegeneration.TargetRef{Type: handler.TargetType(), ID: draft.ID, Revision: draft.Revision},
		Config: draft.Config, Inputs: inputs,
		OutputOwner: domainimagegeneration.OutputAssetOwner{Type: domainasset.OwnerResource, ID: draft.ResourceID},
	}, nil
}

func (handler *TargetHandler) BindResult(ctx context.Context, run domainimagegeneration.Run, outputAssetID string) (domainimagegeneration.BindingOutcome, error) {
	if handler == nil || handler.drafts == nil || handler.resourceAssets == nil || run.Target.Type != handler.TargetType() {
		return "", domainimagegeneration.ErrInvalidGeneration
	}
	scope := DraftScope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	draft, err := handler.drafts.GetForUpdate(ctx, scope, run.Target.ID)
	if errors.Is(err, ErrDraftNotFound) {
		return domainimagegeneration.BindingTargetInvalidated, nil
	}
	if err != nil {
		return "", err
	}
	if draft.ActiveTaskRunID != run.TaskRunID {
		return domainimagegeneration.BindingTargetInvalidated, nil
	}
	if run.OutputOwner.Type != domainasset.OwnerResource || run.OutputOwner.ID != draft.ResourceID {
		return "", ErrDraftRunConflict
	}
	target, err := handler.resourceAssets.GetResourceAssetForUpdate(ctx, draft.ResourceID, draft.ResourceAssetID)
	if errors.Is(err, applicationresource.ErrResourceAssetNotFound) {
		return handler.invalidate(ctx, scope, draft, run)
	}
	if err != nil {
		return "", err
	}
	if !matchesDraftTarget(target, draft) {
		return handler.invalidate(ctx, scope, draft, run)
	}
	expectedRevision := target.Revision
	replacedAssetID := target.CurrentAssetID
	if err = target.ApplyGeneratedAsset(outputAssetID, draft.ID, run.UpdatedAt); err != nil {
		return "", err
	}
	if err = handler.resourceAssets.UpdateResourceAsset(ctx, target, expectedRevision, &outputAssetID); err != nil {
		return "", err
	}
	if handler.references != nil {
		if err = handler.references.AcquireAssets(ctx, applicationasset.AcquireAssetsInput{
			Scope:    applicationasset.ReferenceScope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID},
			Owner:    applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerResourceAssetRevision, Key: target.ID},
			AssetIDs: []string{outputAssetID},
		}); err != nil {
			return "", err
		}
	}
	if handler.reviewCleanup != nil && replacedAssetID != "" && replacedAssetID != outputAssetID {
		if err = handler.reviewCleanup.PrepareReviewCleanup(ctx, applicationasset.Scope{
			TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy,
		}, []string{replacedAssetID}); err != nil {
			return "", err
		}
	}
	cleared, err := handler.drafts.ClearActiveTaskRun(ctx, scope, draft.ID, run.TaskRunID)
	if err != nil {
		return "", err
	}
	if !cleared {
		return "", ErrDraftRunConflict
	}
	return domainimagegeneration.BindingBound, nil
}

func (handler *TargetHandler) ReleaseRun(ctx context.Context, run domainimagegeneration.Run) error {
	if handler == nil || handler.drafts == nil || run.Target.Type != handler.TargetType() {
		return domainimagegeneration.ErrInvalidGeneration
	}
	scope := DraftScope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	draft, err := handler.drafts.GetForUpdate(ctx, scope, run.Target.ID)
	if errors.Is(err, ErrDraftNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if draft.ActiveTaskRunID == "" {
		return nil
	}
	if draft.ActiveTaskRunID != run.TaskRunID {
		return ErrDraftRunConflict
	}
	cleared, err := handler.drafts.ClearActiveTaskRun(ctx, scope, draft.ID, run.TaskRunID)
	if err != nil {
		return err
	}
	if !cleared {
		return ErrDraftRunConflict
	}
	return nil
}

func (handler *TargetHandler) FailRun(ctx context.Context, run domainimagegeneration.Run) error {
	if handler == nil || handler.drafts == nil || handler.resourceAssets == nil || run.Target.Type != handler.TargetType() {
		return domainimagegeneration.ErrInvalidGeneration
	}
	scope := DraftScope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	draft, err := handler.drafts.GetForUpdate(ctx, scope, run.Target.ID)
	if errors.Is(err, ErrDraftNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if draft.ActiveTaskRunID == "" {
		return nil
	}
	if draft.ActiveTaskRunID != run.TaskRunID {
		return ErrDraftRunConflict
	}
	target, err := handler.resourceAssets.GetResourceAssetForUpdate(ctx, draft.ResourceID, draft.ResourceAssetID)
	if errors.Is(err, applicationresource.ErrResourceAssetNotFound) {
		_, releaseErr := handler.invalidate(ctx, scope, draft, run)
		return releaseErr
	}
	if err != nil {
		return err
	}
	if !matchesDraftTarget(target, draft) {
		_, err = handler.invalidate(ctx, scope, draft, run)
		return err
	}
	expectedRevision := target.Revision
	replacedAssetID := target.CurrentAssetID
	if err = target.ClearGeneratedAsset(draft.ID, run.UpdatedAt); err != nil {
		return err
	}
	if replacedAssetID != "" {
		if err = handler.resourceAssets.UpdateResourceAsset(ctx, target, expectedRevision, nil); err != nil {
			return err
		}
		if handler.reviewCleanup != nil {
			if err = handler.reviewCleanup.PrepareReviewCleanup(ctx, applicationasset.Scope{
				TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy,
			}, []string{replacedAssetID}); err != nil {
				return err
			}
		}
	}
	cleared, err := handler.drafts.ClearActiveTaskRun(ctx, scope, draft.ID, run.TaskRunID)
	if err != nil {
		return err
	}
	if !cleared {
		return ErrDraftRunConflict
	}
	return nil
}

func (handler *TargetHandler) resolveInputs(ctx context.Context, scope applicationimagegeneration.Scope, draft domainresourceassetgeneration.Draft, target domainresource.ResourceAsset) ([]domainimagegeneration.ResolvedInput, error) {
	inputs := make([]domainimagegeneration.ResolvedInput, 0, len(draft.UploadedReferences)+len(draft.ResourceReferences))
	for _, reference := range draft.UploadedReferences {
		item, err := handler.assets.BypassGetForUpdate(ctx, applicationasset.BypassGetInput{
			Scope: applicationasset.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}, AssetID: reference.AssetID,
		})
		if err != nil {
			if errors.Is(err, applicationasset.ErrNotFound) || errno.IsCode(err, errno.ErrNotFound) {
				return nil, ErrDraftReferenceInvalid
			}
			return nil, err
		}
		if item.ID != reference.AssetID || item.TenantID != draft.TenantID || !sameDraftWorkspace(item.WorkspaceID, draft.WorkspaceID) ||
			item.OwnerType != domainasset.OwnerResource || item.OwnerID != draft.ResourceID || item.MediaType != domainasset.MediaImage {
			return nil, ErrDraftReferenceInvalid
		}
		inputs = append(inputs, domainimagegeneration.ResolvedInput{Position: int32(len(inputs)), SourceType: domainimagegeneration.InputSourceUploaded, AssetID: item.ID})
	}
	for _, reference := range draft.ResourceReferences {
		slot, err := handler.resourceAssets.GetResourceAssetBySequenceForUpdate(ctx, reference.ResourceID, reference.SequenceNo)
		if err != nil {
			if errors.Is(err, applicationresource.ErrResourceAssetNotFound) {
				return nil, ErrDraftReferenceInvalid
			}
			return nil, err
		}
		if reference.ResourceID != draft.ResourceID || slot.ResourceID != draft.ResourceID || slot.ID == target.ID ||
			slot.CurrentAssetID == "" || slot.MediaType != domainasset.MediaImage {
			return nil, ErrDraftReferenceInvalid
		}
		inputs = append(inputs, domainimagegeneration.ResolvedInput{Position: int32(len(inputs)), SourceType: domainimagegeneration.InputSourceResourceAsset, AssetID: slot.CurrentAssetID})
	}
	return inputs, nil
}

func (handler *TargetHandler) invalidate(ctx context.Context, scope DraftScope, draft domainresourceassetgeneration.Draft, run domainimagegeneration.Run) (domainimagegeneration.BindingOutcome, error) {
	cleared, err := handler.drafts.ClearActiveTaskRun(ctx, scope, draft.ID, run.TaskRunID)
	if err != nil {
		return "", err
	}
	if !cleared {
		return "", ErrDraftRunConflict
	}
	return domainimagegeneration.BindingTargetInvalidated, nil
}

func matchesDraftTarget(target domainresource.ResourceAsset, draft domainresourceassetgeneration.Draft) bool {
	return target.ID == draft.ResourceAssetID && target.ResourceID == draft.ResourceID &&
		target.SourceType == domainresource.SourceGenerated && target.ImageGenerationDraftID == draft.ID
}

func draftScope(scope applicationimagegeneration.Scope) DraftScope {
	return DraftScope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, CallerID: scope.CallerID}
}

func sameDraftWorkspace(actual, expected *string) bool {
	if actual == nil || expected == nil {
		return actual == nil && expected == nil
	}
	return *actual == *expected
}

var _ applicationimagegeneration.TargetHandler = (*TargetHandler)(nil)
