package application

import (
	"context"
	"errors"
	"log/slog"
	"time"

	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	assetCleanupInterval = time.Hour
	assetMinimumAge      = 24 * time.Hour
	assetRetention       = 7 * 24 * time.Hour
	assetCleanupLease    = 2 * time.Minute
	assetCleanupBatch    = 100
)

func (s *Service) RunAssetCleanup(ctx context.Context) {
	ticker := time.NewTicker(assetCleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if count, err := s.cleanupAssets(ctx, time.Now().UTC()); err != nil && ctx.Err() == nil {
				slog.Error("canvas asset cleanup round failed", "completed", count, "error", err)
			}
		}
	}
}

func (s *Service) cleanupAssets(ctx context.Context, now time.Time) (int, error) {
	if err := s.markUnreferencedAssets(ctx, now); err != nil {
		return 0, err
	}
	var candidates []p.AssetGCCandidate
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("purge_not_before <= ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)", now, now, now).
			Order("next_attempt_at, asset_id").Limit(assetCleanupBatch).Find(&candidates).Error
	})
	if err != nil {
		return 0, err
	}
	completed := 0
	var failures error
	for i := range candidates {
		item := &candidates[i]
		leaseUntil := now.Add(assetCleanupLease)
		claimed := s.DB.WithContext(ctx).Model(&p.AssetGCCandidate{}).
			Where("asset_id = ? AND state_version = ? AND (lease_until IS NULL OR lease_until <= ?)", item.AssetID, item.StateVersion, now).
			Updates(map[string]any{"lease_until": leaseUntil, "state_version": item.StateVersion + 1, "updated_at": now})
		if claimed.Error != nil {
			failures = errors.Join(failures, claimed.Error)
			continue
		}
		if claimed.RowsAffected == 0 {
			continue
		}
		item.StateVersion++
		if err := s.purgeAsset(ctx, *item, now); err != nil {
			failures = errors.Join(failures, err, s.rescheduleAssetCleanup(ctx, *item, now, err))
			continue
		}
		completed++
	}
	return completed, failures
}

func (s *Service) markUnreferencedAssets(ctx context.Context, now time.Time) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var assets []p.Asset
		err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("created_at <= ? AND NOT EXISTS (SELECT 1 FROM asset_references WHERE asset_references.asset_id = assets.id AND asset_references.deleted_at IS NULL)", now.Add(-assetMinimumAge)).
			Order("created_at, id").Limit(assetCleanupBatch).Find(&assets).Error
		if err != nil {
			return err
		}
		for i := range assets {
			asset := assets[i]
			if err = tx.Delete(&asset).Error; err != nil {
				return err
			}
			candidate := p.AssetGCCandidate{
				AssetID: asset.ID, TenantID: asset.TenantID, WorkspaceID: asset.WorkspaceID,
				ProjectID: asset.ProjectID, ObjectKey: asset.ObjectKey,
				PurgeNotBefore: now.Add(assetRetention), NextAttemptAt: now.Add(assetRetention),
				StateVersion: 1, CreatedAt: now, UpdatedAt: now,
			}
			if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) purgeAsset(ctx context.Context, item p.AssetGCCandidate, now time.Time) error {
	var activeReferences int64
	if err := s.DB.WithContext(ctx).Model(&p.AssetReference{}).Where("asset_id = ?", item.AssetID).Count(&activeReferences).Error; err != nil {
		return err
	}
	if activeReferences > 0 {
		return errors.New("asset references remain")
	}
	var otherOwners int64
	if err := s.DB.WithContext(ctx).Unscoped().Model(&p.Asset{}).
		Where("id <> ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND object_key = ?", item.AssetID, item.TenantID, item.WorkspaceID, item.ProjectID, item.ObjectKey).
		Count(&otherOwners).Error; err != nil {
		return err
	}
	var archiveOwners int64
	if err := s.DB.WithContext(ctx).Table("canvas_video_archive_exports").
		Where("tenant_id = ? AND workspace_id = ? AND project_id = ? AND output_path = ? AND cleanup_status <> ?", item.TenantID, item.WorkspaceID, item.ProjectID, item.ObjectKey, "completed").
		Count(&archiveOwners).Error; err != nil {
		return err
	}
	if otherOwners == 0 && archiveOwners == 0 {
		if err := s.Storage.Delete(ctx, storage.Scope(item.TenantID, item.WorkspaceID, item.ProjectID), item.ObjectKey); err != nil {
			return err
		}
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		deleted := tx.Where("asset_id = ? AND state_version = ?", item.AssetID, item.StateVersion).Delete(&p.AssetGCCandidate{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected == 0 {
			return errors.New("asset cleanup state changed")
		}
		if err := tx.Unscoped().Where("asset_id = ?", item.AssetID).Delete(&p.AssetReference{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Where("id = ?", item.AssetID).Delete(&p.Asset{}).Error
	})
}

func (s *Service) rescheduleAssetCleanup(ctx context.Context, item p.AssetGCCandidate, now time.Time, cause error) error {
	delay := time.Minute << min(item.Attempts, 6)
	message := cause.Error()
	if len(message) > 512 {
		message = message[:512]
	}
	return s.DB.WithContext(ctx).Model(&p.AssetGCCandidate{}).
		Where("asset_id = ? AND state_version = ?", item.AssetID, item.StateVersion).
		Updates(map[string]any{
			"attempts": item.Attempts + 1, "last_error": message, "lease_until": nil,
			"next_attempt_at": now.Add(delay), "state_version": item.StateVersion + 1, "updated_at": now,
		}).Error
}
