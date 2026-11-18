package resourceassetgeneration

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	applicationresourceassetgeneration "github.com/example/monorepo/canvas/internal/application/resourceassetgeneration"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/domain/resourceassetgeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

type draftRow = sqlc.ResourceAssetImageGenerationDraft
type uploadedReferenceRow = sqlc.ResourceAssetImageGenerationUploadedReference
type resourceReferenceRow = sqlc.ResourceAssetImageGenerationResourceReference

func rowsFromDomain(draft domainresourceassetgeneration.Draft) (draftRow, []uploadedReferenceRow, []resourceReferenceRow, error) {
	id, err := persistenceid.Parse(draft.ID)
	if err != nil {
		return draftRow{}, nil, nil, fmt.Errorf("map draft ID: %w", err)
	}
	resourceID, err := persistenceid.Parse(draft.ResourceID)
	if err != nil {
		return draftRow{}, nil, nil, fmt.Errorf("map resource ID: %w", err)
	}
	resourceAssetID, err := persistenceid.Parse(draft.ResourceAssetID)
	if err != nil {
		return draftRow{}, nil, nil, fmt.Errorf("map ResourceAsset ID: %w", err)
	}
	activeTaskRunID, err := persistenceid.ParseOptional(draft.ActiveTaskRunID)
	if err != nil {
		return draftRow{}, nil, nil, fmt.Errorf("map active TaskRun ID: %w", err)
	}
	row := draftRow{
		ID: id.String(), TenantID: draft.TenantID, WorkspaceID: draft.WorkspaceID,
		ResourceID: resourceID.String(), ResourceAssetID: resourceAssetID.String(),
		Prompt: draft.Config.Prompt, ModelID: draft.Config.ModelID,
		Resolution: string(draft.Config.Resolution), AspectRatio: string(draft.Config.AspectRatio), Watermark: draft.Config.Watermark,
		Revision: draft.Revision, ActiveTaskRunID: persistenceid.OptionalText(activeTaskRunID),
		CreatedBy: draft.CreatedBy, CreatedAt: draft.CreatedAt, UpdatedAt: draft.UpdatedAt,
	}
	uploaded := make([]uploadedReferenceRow, 0, len(draft.UploadedReferences))
	for index, reference := range draft.UploadedReferences {
		assetID, parseErr := persistenceid.Parse(reference.AssetID)
		if parseErr != nil {
			return draftRow{}, nil, nil, fmt.Errorf("map uploaded reference Asset ID: %w", parseErr)
		}
		uploaded = append(uploaded, uploadedReferenceRow{DraftID: id.String(), Position: int32(index), AssetID: assetID.String()})
	}
	resources := make([]resourceReferenceRow, 0, len(draft.ResourceReferences))
	for index, reference := range draft.ResourceReferences {
		referenceResourceID, parseErr := persistenceid.Parse(reference.ResourceID)
		if parseErr != nil {
			return draftRow{}, nil, nil, fmt.Errorf("map resource reference ID: %w", parseErr)
		}
		resources = append(resources, resourceReferenceRow{DraftID: id.String(), Position: int32(index), ResourceID: referenceResourceID.String(), SequenceNo: reference.SequenceNo})
	}
	return row, uploaded, resources, nil
}

func domainFromRows(row draftRow, uploaded []uploadedReferenceRow, resources []resourceReferenceRow) domainresourceassetgeneration.Draft {
	draft := domainresourceassetgeneration.Draft{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ResourceID: row.ResourceID, ResourceAssetID: row.ResourceAssetID,
		Config: domainimagegeneration.Config{
			Prompt: row.Prompt, ModelID: row.ModelID, Resolution: domainimagegeneration.Resolution(row.Resolution),
			AspectRatio: domainimagegeneration.AspectRatio(row.AspectRatio), Watermark: row.Watermark,
		},
		Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	if row.ActiveTaskRunID != nil {
		draft.ActiveTaskRunID = *row.ActiveTaskRunID
	}
	for _, reference := range uploaded {
		draft.UploadedReferences = append(draft.UploadedReferences, domainresourceassetgeneration.UploadedReference{AssetID: reference.AssetID})
	}
	for _, reference := range resources {
		draft.ResourceReferences = append(draft.ResourceReferences, domainresourceassetgeneration.ResourceReference{ResourceID: reference.ResourceID, SequenceNo: reference.SequenceNo})
	}
	return draft
}

func referenceDelta(previous, current []uploadedReferenceRow) applicationresourceassetgeneration.ReferenceDelta {
	previousIDs := make(map[string]struct{}, len(previous))
	currentIDs := make(map[string]struct{}, len(current))
	for _, reference := range previous {
		previousIDs[reference.AssetID] = struct{}{}
	}
	for _, reference := range current {
		currentIDs[reference.AssetID] = struct{}{}
	}
	delta := applicationresourceassetgeneration.ReferenceDelta{}
	for _, reference := range current {
		if _, exists := previousIDs[reference.AssetID]; !exists {
			delta.AddedAssetIDs = append(delta.AddedAssetIDs, reference.AssetID)
		}
	}
	for _, reference := range previous {
		if _, exists := currentIDs[reference.AssetID]; !exists {
			delta.RemovedAssetIDs = append(delta.RemovedAssetIDs, reference.AssetID)
		}
	}
	return delta
}

func readError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationresourceassetgeneration.ErrDraftNotFound
	}
	return err
}

func (r *Repository) writeRefs(ctx context.Context, uploaded []uploadedReferenceRow, resources []resourceReferenceRow) error {
	for _, row := range uploaded {
		if err := r.db.Queries(ctx).InsertUploadedDraftRef(ctx, sqlc.InsertUploadedDraftRefParams{
			DraftID:       row.DraftID,
			PositionIndex: row.Position,
			AssetID:       row.AssetID,
		}); err != nil {
			return err
		}
	}
	for _, row := range resources {
		if err := r.db.Queries(ctx).InsertResourceDraftRef(ctx, sqlc.InsertResourceDraftRefParams{
			DraftID:       row.DraftID,
			PositionIndex: row.Position,
			ResourceID:    row.ResourceID,
			SequenceNo:    row.SequenceNo,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) Create(ctx context.Context, draft domainresourceassetgeneration.Draft) error {
	row, uploaded, resources, err := rowsFromDomain(draft)
	if err != nil {
		return err
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := r.db.Queries(ctx).InsertGenerationDraft(ctx, sqlc.InsertGenerationDraftParams{
			ID:              row.ID,
			TenantID:        row.TenantID,
			WorkspaceID:     row.WorkspaceID,
			ResourceID:      row.ResourceID,
			ResourceAssetID: row.ResourceAssetID,
			Prompt:          row.Prompt,
			ModelID:         row.ModelID,
			Resolution:      row.Resolution,
			AspectRatio:     row.AspectRatio,
			Watermark:       row.Watermark,
			Revision:        row.Revision,
			ActiveTaskRunID: row.ActiveTaskRunID,
			CreatedBy:       row.CreatedBy,
			CreatedAt:       row.CreatedAt,
			UpdatedAt:       row.UpdatedAt,
		}); err != nil {
			return err
		}
		return r.writeRefs(ctx, uploaded, resources)
	})
}

func (r *Repository) Get(ctx context.Context, scope applicationresourceassetgeneration.DraftScope, draftID string) (domainresourceassetgeneration.Draft, error) {
	return r.get(ctx, scope, draftID, false)
}

func (r *Repository) GetForUpdate(ctx context.Context, scope applicationresourceassetgeneration.DraftScope, draftID string) (domainresourceassetgeneration.Draft, error) {
	return r.get(ctx, scope, draftID, true)
}

func (r *Repository) get(ctx context.Context, scope applicationresourceassetgeneration.DraftScope, draftID string, lock bool) (domainresourceassetgeneration.Draft, error) {
	id, err := persistenceid.Parse(draftID)
	if err != nil {
		return domainresourceassetgeneration.Draft{}, applicationresourceassetgeneration.ErrDraftNotFound
	}
	var row draftRow
	if lock {
		row, err = r.db.Queries(ctx).LockGenerationDraft(ctx, sqlc.LockGenerationDraftParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ID:          id.String(),
		})
	} else {
		row, err = r.db.Queries(ctx).ReadGenerationDraft(ctx, sqlc.ReadGenerationDraftParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ID:          id.String(),
		})
	}
	if err != nil {
		return domainresourceassetgeneration.Draft{}, readError(err)
	}
	q := r.db.Queries(ctx)
	uploaded, err := q.ReadUploadedDraftRefs(ctx, row.ID)
	if err != nil {
		return domainresourceassetgeneration.Draft{}, err
	}
	refs, err := q.ReadResourceDraftRefs(ctx, row.ID)
	if err != nil {
		return domainresourceassetgeneration.Draft{}, err
	}
	return domainFromRows(row, uploaded, refs), nil
}

func (r *Repository) Update(ctx context.Context, draft domainresourceassetgeneration.Draft, expectedRevision int64) (applicationresourceassetgeneration.ReferenceDelta, error) {
	row, uploaded, resources, err := rowsFromDomain(draft)
	if err != nil || draft.Revision != expectedRevision+1 {
		if err != nil {
			return applicationresourceassetgeneration.ReferenceDelta{}, err
		}
		return applicationresourceassetgeneration.ReferenceDelta{}, applicationresourceassetgeneration.ErrDraftRevisionConflict
	}
	delta := applicationresourceassetgeneration.ReferenceDelta{}
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ModifyGenerationDraft(ctx, sqlc.ModifyGenerationDraftParams{
			Prompt:           row.Prompt,
			ModelID:          row.ModelID,
			Resolution:       row.Resolution,
			AspectRatio:      row.AspectRatio,
			Watermark:        row.Watermark,
			Revision:         row.Revision,
			UpdatedAt:        row.UpdatedAt,
			TenantID:         row.TenantID,
			WorkspaceID:      row.WorkspaceID,
			ID:               row.ID,
			ExpectedRevision: expectedRevision,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationresourceassetgeneration.ErrDraftRevisionConflict
		}
		q := r.db.Queries(ctx)
		previous, err := q.ReadUploadedDraftRefs(ctx, row.ID)
		if err != nil {
			return err
		}
		if err := q.ClearUploadedDraftRefs(ctx, row.ID); err != nil {
			return err
		}
		if err := q.ClearResourceDraftRefs(ctx, row.ID); err != nil {
			return err
		}
		if err := r.writeRefs(ctx, uploaded, resources); err != nil {
			return err
		}
		delta = referenceDelta(previous, uploaded)
		return nil
	})
	return delta, err
}

func (r *Repository) Delete(ctx context.Context, tenantID string, workspaceID *string, draftID string, deletedAt time.Time) ([]string, error) {
	id, err := persistenceid.Parse(draftID)
	if err != nil {
		return nil, applicationresourceassetgeneration.ErrDraftNotFound
	}
	var assets []string
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		row, err := r.db.Queries(ctx).LockGenerationDraft(ctx, sqlc.LockGenerationDraftParams{
			TenantID:    tenantID,
			WorkspaceID: workspaceID,
			ID:          id.String(),
		})
		if err != nil {
			return readError(err)
		}
		ids := []string{row.ID}
		assets, err = r.db.Queries(ctx).ListUploadedDraftAssetIDs(ctx, ids)
		if err != nil {
			return err
		}
		return r.db.Queries(ctx).RetireGenerationDrafts(ctx, sqlc.RetireGenerationDraftsParams{
			RetiredAt: deletedAt.UnixMilli(),
			Ids:       ids,
		})
	})
	return assets, err
}

func (r *Repository) DeleteByResource(ctx context.Context, tenantID string, workspaceID *string, resourceID string, deletedAt time.Time) ([]string, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return nil, err
	}
	var assets []string
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		ids, err := r.db.Queries(ctx).LockResourceDrafts(ctx, sqlc.LockResourceDraftsParams{
			TenantID:    tenantID,
			WorkspaceID: workspaceID,
			ResourceID:  id.String(),
		})
		if err != nil {
			return readError(err)
		}
		assets, err = r.db.Queries(ctx).ListUploadedDraftAssetIDs(ctx, ids)
		if err != nil {
			return err
		}
		return r.db.Queries(ctx).RetireGenerationDrafts(ctx, sqlc.RetireGenerationDraftsParams{
			RetiredAt: deletedAt.UnixMilli(),
			Ids:       ids,
		})
	})
	return assets, err
}

func (r *Repository) SetActiveTaskRun(ctx context.Context, scope applicationresourceassetgeneration.DraftScope, draftID, taskRunID string) (bool, error) {
	id, err := persistenceid.Parse(draftID)
	if err != nil {
		return false, applicationresourceassetgeneration.ErrDraftNotFound
	}
	taskID, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, fmt.Errorf("map active TaskRun ID: %w", err)
	}
	n, err := r.db.Queries(ctx).SetDraftActiveRun(ctx, sqlc.SetDraftActiveRunParams{
		TaskID:      taskID.String(),
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          id.String(),
	})
	return n == 1, err
}

func (r *Repository) ClearActiveTaskRun(ctx context.Context, scope applicationresourceassetgeneration.DraftScope, draftID, taskRunID string) (bool, error) {
	id, err := persistenceid.Parse(draftID)
	if err != nil {
		return false, applicationresourceassetgeneration.ErrDraftNotFound
	}
	taskID, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return false, fmt.Errorf("map active TaskRun ID: %w", err)
	}
	n, err := r.db.Queries(ctx).ClearDraftActiveRun(ctx, sqlc.ClearDraftActiveRunParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          id.String(),
		TaskID:      taskID.String(),
	})
	return n == 1, err
}
