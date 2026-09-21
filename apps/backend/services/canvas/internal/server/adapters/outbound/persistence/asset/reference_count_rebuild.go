package asset

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
)

func (r *Repository) ListReferenceCountAssets(
	ctx context.Context,
	windowStart time.Time,
	windowEnd time.Time,
	afterAssetID string,
	limit int,
) ([]applicationasset.ReferenceCountAsset, error) {
	if limit <= 0 {
		return []applicationasset.ReferenceCountAsset{}, nil
	}
	if windowStart.IsZero() || !windowStart.Before(windowEnd) {
		return nil, applicationasset.ErrInvalidReferenceInput
	}
	db := r.dbFor(ctx)
	changedAssetIDs := db.Unscoped().Model(&assetReferenceRow{}).Distinct("asset_id").
		Where("updated_at >= ? AND updated_at < ?", windowStart, windowEnd)
	query := db.Model(&assetRow{}).Select("id", "tenant_id", "workspace_id").
		Where("id IN (?)", changedAssetIDs)
	if afterAssetID != "" {
		after, err := persistenceid.Parse(afterAssetID)
		if err != nil {
			return nil, applicationasset.ErrInvalidReferenceInput
		}
		query = query.Where("id > ?", after)
	}
	var rows []assetRow
	if err := query.Order("id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]applicationasset.ReferenceCountAsset, len(rows))
	for index := range rows {
		result[index] = applicationasset.ReferenceCountAsset{
			AssetID: rows[index].ID.String(), TenantID: rows[index].TenantID, WorkspaceID: cloneString(rows[index].WorkspaceID),
		}
	}
	return result, nil
}

func (r *Repository) ReplaceReferenceCounts(ctx context.Context, updates []applicationasset.ReferenceCountUpdate) error {
	type parsedUpdate struct {
		id    persistenceid.UUID
		scope applicationasset.ReferenceScope
		count int32
	}
	parsed := make([]parsedUpdate, len(updates))
	for index, update := range updates {
		id, err := persistenceid.Parse(update.AssetID)
		if err != nil || update.TenantID == "" || update.Count < 0 {
			return applicationasset.ErrInvalidReferenceInput
		}
		parsed[index] = parsedUpdate{
			id: id, scope: applicationasset.ReferenceScope{TenantID: update.TenantID, WorkspaceID: update.WorkspaceID}, count: update.Count,
		}
	}
	return r.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		for _, update := range parsed {
			result := referenceAssetScopeQuery(tx, update.scope).Where("id = ?", update.id).
				UpdateColumn("reference_count", update.count)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return applicationasset.ErrNotFound
			}
		}
		return nil
	})
}
