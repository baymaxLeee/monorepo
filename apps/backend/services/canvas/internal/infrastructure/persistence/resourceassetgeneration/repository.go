package resourceassetgeneration

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationresourceassetgeneration "github.com/example/monorepo/canvas/internal/application/resourceassetgeneration"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domainresourceassetgeneration "github.com/example/monorepo/canvas/internal/domain/resourceassetgeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, draft domainresourceassetgeneration.Draft) error {
	row, uploaded, resources, err := rowsFromDomain(draft)
	if err != nil {
		return err
	}
	return persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if len(uploaded) > 0 {
			if err := tx.Create(&uploaded).Error; err != nil {
				return err
			}
		}
		if len(resources) > 0 {
			return tx.Create(&resources).Error
		}
		return nil
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
	db := persistencetransaction.DB(ctx, r.db)
	var row draftRow
	query := scopedQuery(db, scope).Where("id = ?", id)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err = query.First(&row).Error; err != nil {
		return domainresourceassetgeneration.Draft{}, readError(err)
	}
	return r.loadDomain(db, row)
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
	err = persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var previous []uploadedReferenceRow
		if err := tx.Where("draft_id = ?", row.ID).Order("position").Find(&previous).Error; err != nil {
			return err
		}
		result := scopedQuery(tx.Model(&draftRow{}), applicationresourceassetgeneration.DraftScope{TenantID: draft.TenantID, WorkspaceID: draft.WorkspaceID}).
			Where("id = ? AND revision = ?", row.ID, expectedRevision).
			Updates(map[string]any{
				"prompt": row.Prompt, "model_id": row.ModelID, "resolution": row.Resolution,
				"aspect_ratio": row.AspectRatio, "watermark": row.Watermark,
				"revision": row.Revision, "updated_at": row.UpdatedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return applicationresourceassetgeneration.ErrDraftRevisionConflict
		}
		if err := tx.Where("draft_id = ?", row.ID).Delete(&uploadedReferenceRow{}).Error; err != nil {
			return err
		}
		if err := tx.Where("draft_id = ?", row.ID).Delete(&resourceReferenceRow{}).Error; err != nil {
			return err
		}
		if len(uploaded) > 0 {
			if err := tx.Create(&uploaded).Error; err != nil {
				return err
			}
		}
		if len(resources) > 0 {
			if err := tx.Create(&resources).Error; err != nil {
				return err
			}
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
	db := persistencetransaction.DB(ctx, r.db)
	scope := applicationresourceassetgeneration.DraftScope{TenantID: tenantID, WorkspaceID: workspaceID}
	var row draftRow
	if err = scopedQuery(db, scope).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&row).Error; err != nil {
		return nil, readError(err)
	}
	assetIDs, err := uploadedAssetIDs(db, []persistenceid.UUID{id})
	if err != nil {
		return nil, err
	}
	err = scopedQuery(db.Model(&draftRow{}), scope).Where("id = ?", id).Updates(map[string]any{
		"active_task_run_id": nil,
		"deleted_at":         deletedAt.UTC().UnixMilli(),
	}).Error
	return assetIDs, err
}

func (r *Repository) DeleteByResource(ctx context.Context, tenantID string, workspaceID *string, resourceID string, deletedAt time.Time) ([]string, error) {
	id, err := persistenceid.Parse(resourceID)
	if err != nil {
		return nil, err
	}
	db := persistencetransaction.DB(ctx, r.db)
	scope := applicationresourceassetgeneration.DraftScope{TenantID: tenantID, WorkspaceID: workspaceID}
	var rows []draftRow
	if err = scopedQuery(db, scope).Clauses(clause.Locking{Strength: "UPDATE"}).Where("resource_id = ?", id).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []string{}, nil
	}
	draftIDs := make([]persistenceid.UUID, len(rows))
	for index := range rows {
		draftIDs[index] = rows[index].ID
	}
	assetIDs, err := uploadedAssetIDs(db, draftIDs)
	if err != nil {
		return nil, err
	}
	err = scopedQuery(db.Model(&draftRow{}), scope).Where("resource_id = ?", id).Updates(map[string]any{
		"active_task_run_id": nil,
		"deleted_at":         deletedAt.UTC().UnixMilli(),
	}).Error
	return assetIDs, err
}

func uploadedAssetIDs(db *gorm.DB, draftIDs []persistenceid.UUID) ([]string, error) {
	var rows []uploadedReferenceRow
	if err := db.Where("draft_id IN ?", draftIDs).Order("draft_id, position").Find(&rows).Error; err != nil {
		return nil, err
	}
	assetIDs := make([]string, len(rows))
	for index := range rows {
		assetIDs[index] = rows[index].AssetID.String()
	}
	return assetIDs, nil
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
	result := scopedQuery(persistencetransaction.DB(ctx, r.db).Model(&draftRow{}), scope).
		Where("id = ? AND active_task_run_id IS NULL", id).Update("active_task_run_id", taskID)
	return result.RowsAffected == 1, result.Error
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
	result := scopedQuery(persistencetransaction.DB(ctx, r.db).Model(&draftRow{}), scope).
		Where("id = ? AND active_task_run_id = ?", id, taskID).Update("active_task_run_id", nil)
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) loadDomain(db *gorm.DB, row draftRow) (domainresourceassetgeneration.Draft, error) {
	var uploaded []uploadedReferenceRow
	if err := db.Where("draft_id = ?", row.ID).Order("position").Find(&uploaded).Error; err != nil {
		return domainresourceassetgeneration.Draft{}, err
	}
	var resources []resourceReferenceRow
	if err := db.Where("draft_id = ?", row.ID).Order("position").Find(&resources).Error; err != nil {
		return domainresourceassetgeneration.Draft{}, err
	}
	return domainFromRows(row, uploaded, resources), nil
}

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
		ID: id, TenantID: draft.TenantID, WorkspaceID: draft.WorkspaceID,
		ResourceID: resourceID, ResourceAssetID: resourceAssetID,
		Prompt: draft.Config.Prompt, ModelID: draft.Config.ModelID,
		Resolution: string(draft.Config.Resolution), AspectRatio: string(draft.Config.AspectRatio), Watermark: draft.Config.Watermark,
		Revision: draft.Revision, ActiveTaskRunID: activeTaskRunID,
		CreatedBy: draft.CreatedBy, CreatedAt: draft.CreatedAt, UpdatedAt: draft.UpdatedAt,
	}
	uploaded := make([]uploadedReferenceRow, 0, len(draft.UploadedReferences))
	for index, reference := range draft.UploadedReferences {
		assetID, parseErr := persistenceid.Parse(reference.AssetID)
		if parseErr != nil {
			return draftRow{}, nil, nil, fmt.Errorf("map uploaded reference Asset ID: %w", parseErr)
		}
		uploaded = append(uploaded, uploadedReferenceRow{DraftID: id, Position: int32(index), AssetID: assetID})
	}
	resources := make([]resourceReferenceRow, 0, len(draft.ResourceReferences))
	for index, reference := range draft.ResourceReferences {
		referenceResourceID, parseErr := persistenceid.Parse(reference.ResourceID)
		if parseErr != nil {
			return draftRow{}, nil, nil, fmt.Errorf("map resource reference ID: %w", parseErr)
		}
		resources = append(resources, resourceReferenceRow{DraftID: id, Position: int32(index), ResourceID: referenceResourceID, SequenceNo: reference.SequenceNo})
	}
	return row, uploaded, resources, nil
}

func domainFromRows(row draftRow, uploaded []uploadedReferenceRow, resources []resourceReferenceRow) domainresourceassetgeneration.Draft {
	draft := domainresourceassetgeneration.Draft{
		ID: row.ID.String(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ResourceID: row.ResourceID.String(), ResourceAssetID: row.ResourceAssetID.String(),
		Config: domainimagegeneration.Config{
			Prompt: row.Prompt, ModelID: row.ModelID, Resolution: domainimagegeneration.Resolution(row.Resolution),
			AspectRatio: domainimagegeneration.AspectRatio(row.AspectRatio), Watermark: row.Watermark,
		},
		Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	if row.ActiveTaskRunID != nil {
		draft.ActiveTaskRunID = row.ActiveTaskRunID.String()
	}
	for _, reference := range uploaded {
		draft.UploadedReferences = append(draft.UploadedReferences, domainresourceassetgeneration.UploadedReference{AssetID: reference.AssetID.String()})
	}
	for _, reference := range resources {
		draft.ResourceReferences = append(draft.ResourceReferences, domainresourceassetgeneration.ResourceReference{ResourceID: reference.ResourceID.String(), SequenceNo: reference.SequenceNo})
	}
	return draft
}

func referenceDelta(previous, current []uploadedReferenceRow) applicationresourceassetgeneration.ReferenceDelta {
	previousIDs := make(map[persistenceid.UUID]struct{}, len(previous))
	currentIDs := make(map[persistenceid.UUID]struct{}, len(current))
	for _, reference := range previous {
		previousIDs[reference.AssetID] = struct{}{}
	}
	for _, reference := range current {
		currentIDs[reference.AssetID] = struct{}{}
	}
	delta := applicationresourceassetgeneration.ReferenceDelta{}
	for _, reference := range current {
		if _, exists := previousIDs[reference.AssetID]; !exists {
			delta.AddedAssetIDs = append(delta.AddedAssetIDs, reference.AssetID.String())
		}
	}
	for _, reference := range previous {
		if _, exists := currentIDs[reference.AssetID]; !exists {
			delta.RemovedAssetIDs = append(delta.RemovedAssetIDs, reference.AssetID.String())
		}
	}
	return delta
}

func scopedQuery(db *gorm.DB, scope applicationresourceassetgeneration.DraftScope) *gorm.DB {
	query := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func readError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationresourceassetgeneration.ErrDraftNotFound
	}
	return err
}
