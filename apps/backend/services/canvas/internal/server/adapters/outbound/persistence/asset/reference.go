package asset

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
)

func (r *Repository) AcquireReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	owner applicationasset.ReferenceOwner,
	assetIDs []string,
	createdAt time.Time,
) error {
	ids, err := validReferenceIDs(assetIDs)
	if err != nil || !owner.Type.Valid() || owner.Key == "" || createdAt.IsZero() {
		return applicationasset.ErrInvalidReferenceInput
	}
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireReferenceAssets(tx, scope, ids); err != nil {
			return err
		}
		for _, id := range ids {
			restored := tx.Unscoped().Model(&assetReferenceRow{}).Where(
				"asset_id = ? AND owner_type = ? AND owner_key = ? AND deleted_at <> 0", id, owner.Type, owner.Key,
			).Updates(map[string]any{"deleted_at": 0, "updated_at": createdAt})
			if restored.Error != nil {
				return restored.Error
			}
			if restored.RowsAffected == 1 {
				if err := incrementReferenceCount(tx, scope, id); err != nil {
					return err
				}
				continue
			}
			row := assetReferenceRow{AssetID: id, OwnerType: string(owner.Type), OwnerKey: owner.Key, CreatedAt: createdAt, UpdatedAt: createdAt}
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected == 0 {
				continue
			}
			if err := incrementReferenceCount(tx, scope, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ReleaseReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	owner applicationasset.ReferenceOwner,
	assetIDs []string,
) error {
	ids, err := validReferenceIDs(assetIDs)
	if err != nil || !owner.Type.Valid() || owner.Key == "" {
		return applicationasset.ErrInvalidReferenceInput
	}
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var releasable []persistenceid.UUID
		if err := referenceAssetScopeQuery(tx, scope).Where("id IN ?", ids).Pluck("id", &releasable).Error; err != nil {
			return err
		}
		changedAt := time.Now().UTC()
		for _, id := range releasable {
			deleted := tx.Model(&assetReferenceRow{}).Where(
				"asset_id = ? AND owner_type = ? AND owner_key = ? AND deleted_at = 0", id, owner.Type, owner.Key,
			).Updates(map[string]any{"deleted_at": changedAt.UnixMilli(), "updated_at": changedAt})
			if deleted.Error != nil {
				return deleted.Error
			}
			if deleted.RowsAffected == 0 {
				continue
			}
			updated := referenceAssetScopeQuery(tx, scope).Where("id = ?", id).
				UpdateColumn("reference_count", gorm.Expr("CASE WHEN reference_count > 0 THEN reference_count - 1 ELSE 0 END"))
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return applicationasset.ErrNotFound
			}
		}
		return nil
	})
}

func (r *Repository) ReleaseOwnerReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	owner applicationasset.ReferenceOwner,
) error {
	if !owner.Type.Valid() || owner.Key == "" {
		return applicationasset.ErrInvalidReferenceInput
	}
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []assetReferenceRow
		query := tx.Model(&assetReferenceRow{}).
			Joins("JOIN assets ON assets.id = asset_references.asset_id").
			Where("asset_references.owner_type = ? AND asset_references.owner_key = ? AND assets.tenant_id = ?", owner.Type, owner.Key, scope.TenantID)
		if scope.WorkspaceID == nil {
			query = query.Where("assets.workspace_id IS NULL")
		} else {
			query = query.Where("assets.workspace_id = ?", *scope.WorkspaceID)
		}
		if err := query.Find(&rows).Error; err != nil {
			return err
		}
		changedAt := time.Now().UTC()
		for _, row := range rows {
			deleted := tx.Model(&assetReferenceRow{}).Where(
				"asset_id = ? AND owner_type = ? AND owner_key = ? AND deleted_at = 0", row.AssetID, row.OwnerType, row.OwnerKey,
			).Updates(map[string]any{"deleted_at": changedAt.UnixMilli(), "updated_at": changedAt})
			if deleted.Error != nil {
				return deleted.Error
			}
			if deleted.RowsAffected == 0 {
				continue
			}
			if err := referenceAssetScopeQuery(tx, scope).Where("id = ?", row.AssetID).
				UpdateColumn("reference_count", gorm.Expr("CASE WHEN reference_count > 0 THEN reference_count - 1 ELSE 0 END")).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) CountReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	assetIDs []string,
) (map[string]int32, error) {
	ids, err := validReferenceIDs(assetIDs)
	if err != nil || scope.TenantID == "" {
		return nil, applicationasset.ErrInvalidReferenceInput
	}
	type referenceCountRow struct {
		AssetID persistenceid.UUID
		Count   int64
	}
	var rows []referenceCountRow
	query := r.dbFor(ctx).Model(&assetReferenceRow{}).
		Joins("JOIN assets ON assets.id = asset_references.asset_id").
		Select("asset_references.asset_id, COUNT(*) AS count").
		Where("asset_references.asset_id IN ? AND assets.tenant_id = ?", ids, scope.TenantID).
		Group("asset_references.asset_id")
	if scope.WorkspaceID == nil {
		query = query.Where("assets.workspace_id IS NULL")
	} else {
		query = query.Where("assets.workspace_id = ?", *scope.WorkspaceID)
	}
	if err = query.Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]int32, len(rows))
	for _, row := range rows {
		if row.Count < 0 || row.Count > int64(^uint32(0)>>1) {
			return nil, applicationasset.ErrInvalidReferenceInput
		}
		result[row.AssetID.String()] = int32(row.Count)
	}
	return result, nil
}

func validReferenceIDs(assetIDs []string) ([]persistenceid.UUID, error) {
	if len(assetIDs) == 0 || len(assetIDs) > 100 {
		return nil, applicationasset.ErrInvalidReferenceInput
	}
	ids := make([]persistenceid.UUID, 0, len(assetIDs))
	seen := make(map[persistenceid.UUID]struct{}, len(assetIDs))
	for _, value := range assetIDs {
		id, err := persistenceid.Parse(value)
		if err != nil {
			return nil, applicationasset.ErrInvalidReferenceInput
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

func requireReferenceAssets(db *gorm.DB, scope applicationasset.ReferenceScope, ids []persistenceid.UUID) error {
	// Acquire and GC take the Asset lock before touching its reference rows.
	// A consistent read would allow a stale snapshot to admit an already-GCed
	// Asset and invert the lock order against the collector's final check.
	var rows []assetRow
	if err := referenceAssetScopeQuery(db, scope).Select("id").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id ASC").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) != len(ids) {
		return applicationasset.ErrNotFound
	}
	return nil
}

func referenceAssetScopeQuery(db *gorm.DB, scope applicationasset.ReferenceScope) *gorm.DB {
	query := db.Model(&assetRow{}).Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func incrementReferenceCount(db *gorm.DB, scope applicationasset.ReferenceScope, id persistenceid.UUID) error {
	updated := referenceAssetScopeQuery(db, scope).Where("id = ?", id).
		UpdateColumn("reference_count", gorm.Expr("reference_count + 1"))
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return applicationasset.ErrNotFound
	}
	return nil
}
