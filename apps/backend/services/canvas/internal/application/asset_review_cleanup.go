package application

import (
	"context"
	"errors"
	"log/slog"
	"time"

	adminclient "github.com/example/monorepo/canvas/internal/infrastructure/admin"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const assetReviewCleanupMaxAttempts int32 = 10

type benefitPackageReviewCleaner interface {
	BeginBenefitPackageReviewCleanup(context.Context, string, string, string, string, string) (adminclient.ReviewCleanup, error)
	CompleteBenefitPackageReviewCleanup(context.Context, string, string, string, string, string) (adminclient.ReviewCleanup, error)
	DeleteReviewedAsset(context.Context, string, string, string, string) error
}

// retireAssetReviews removes reviews from the active view in the same transaction as
// the resource mutation. Provider deletion and entitlement release are durably queued.
func (s *Service) retireAssetReviews(tx *gorm.DB, actor Actor, assetIDs []string, packageID string, now time.Time) ([]string, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	var rows []p.AssetReview
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"tenant_id = ? AND workspace_id = ? AND asset_id IN ?", actor.TenantID, actor.WorkspaceID, assetIDs,
	)
	if packageID != "" {
		query = query.Where("benefit_package_id = ?", packageID)
	}
	if err := query.Order("created_at,id").Find(&rows).Error; err != nil {
		return nil, err
	}
	cleanupIDs := make([]string, 0, len(rows))
	for i := range rows {
		row := rows[i]
		if row.Status == "SUBMITTING" && row.SubmissionStartedAt != nil && row.ProviderAssetID == "" {
			return nil, ConflictMessage("asset_review_submission_in_progress", "素材正在提交审核，请稍后重试")
		}
		cleanup := p.AssetReviewCleanup{
			ID: newID(), ReviewID: row.ID, AssetID: row.AssetID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
			BenefitPackageID: row.BenefitPackageID, ReservationID: row.ReservationID,
			ProviderAssetID: row.ProviderAssetID, Status: "pending", NextAttemptAt: now,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Create(&cleanup).Error; err != nil {
			return nil, err
		}
		if err := tx.Delete(&row).Error; err != nil {
			return nil, err
		}
		cleanupIDs = append(cleanupIDs, cleanup.ID)
	}
	return cleanupIDs, nil
}

// ProcessDueAssetReviewCleanups is the bounded entry point for the shared
// background runner. Startup and scheduling stay outside this module.
func (s *Service) ProcessDueAssetReviewCleanups(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	var ids []string
	if err := s.DB.WithContext(ctx).Model(&p.AssetReviewCleanup{}).Where(
		"status = ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
		"pending", time.Now().UTC(), time.Now().UTC(),
	).Order("next_attempt_at,id").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	s.processAssetReviewCleanups(ctx, ids)
	return len(ids), nil
}

func (s *Service) retryAssetReviewCleanupsForAsset(ctx context.Context, actor Actor, assetID, packageID string) {
	var ids []string
	if err := s.DB.WithContext(ctx).Model(&p.AssetReviewCleanup{}).Where(
		"tenant_id = ? AND workspace_id = ? AND asset_id = ? AND benefit_package_id = ? AND status = ? AND next_attempt_at <= ?",
		actor.TenantID, actor.WorkspaceID, assetID, packageID, "pending", time.Now().UTC(),
	).Order("created_at,id").Limit(20).Pluck("id", &ids).Error; err != nil {
		slog.Error("canvas asset review cleanup lookup failed", "asset_id", assetID, "error", err)
		return
	}
	s.processAssetReviewCleanups(ctx, ids)
}

func (s *Service) processAssetReviewCleanups(ctx context.Context, cleanupIDs []string) {
	cleaner, ok := s.ProviderDirectory.(benefitPackageReviewCleaner)
	if !ok || len(cleanupIDs) == 0 {
		return
	}
	for _, cleanupID := range cleanupIDs {
		if err := s.processAssetReviewCleanup(ctx, cleaner, cleanupID); err != nil {
			slog.Error("canvas asset review cleanup failed", "cleanup_id", cleanupID, "error", err)
		}
	}
}

func (s *Service) processAssetReviewCleanup(ctx context.Context, cleaner benefitPackageReviewCleaner, cleanupID string) error {
	now := time.Now().UTC()
	leaseToken := newID()
	var item p.AssetReviewCleanup
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", cleanupID).First(&item).Error; err != nil {
			return err
		}
		if item.Status == "completed" || item.Status == "dead" {
			return nil
		}
		if item.NextAttemptAt.After(now) || item.LeaseUntil != nil && item.LeaseUntil.After(now) {
			return nil
		}
		item.Status = "running"
		item.LeaseToken = leaseToken
		leaseUntil := now.Add(2 * time.Minute)
		item.LeaseUntil = &leaseUntil
		item.Attempts++
		item.UpdatedAt = now
		return tx.Save(&item).Error
	})
	if err != nil || item.LeaseToken != leaseToken {
		return err
	}
	_, err = cleaner.BeginBenefitPackageReviewCleanup(ctx, item.TenantID, item.WorkspaceID, item.BenefitPackageID, item.ReservationID, item.ID)
	if err == nil && item.ProviderAssetID != "" {
		err = cleaner.DeleteReviewedAsset(ctx, item.TenantID, item.WorkspaceID, item.BenefitPackageID, item.ProviderAssetID)
	}
	if err == nil {
		_, err = cleaner.CompleteBenefitPackageReviewCleanup(ctx, item.TenantID, item.WorkspaceID, item.BenefitPackageID, item.ReservationID, item.ID)
	}
	return s.finishAssetReviewCleanup(ctx, item, leaseToken, err)
}

func (s *Service) finishAssetReviewCleanup(ctx context.Context, item p.AssetReviewCleanup, leaseToken string, cleanupErr error) error {
	now := time.Now().UTC()
	updates := map[string]any{"lease_token": "", "lease_until": nil, "updated_at": now}
	if cleanupErr == nil {
		updates["status"] = "completed"
		updates["completed_at"] = now
		updates["last_error"] = ""
	} else {
		message := cleanupErr.Error()
		if len(message) > 512 {
			message = message[:512]
		}
		updates["status"] = "pending"
		if item.Attempts >= assetReviewCleanupMaxAttempts {
			updates["status"] = "dead"
		}
		updates["last_error"] = message
		updates["next_attempt_at"] = now.Add(assetReviewCleanupRetryDelay(item.Attempts))
	}
	result := s.DB.WithContext(ctx).Model(&p.AssetReviewCleanup{}).Where(
		"id = ? AND status = ? AND lease_token = ?", item.ID, "running", leaseToken,
	).Updates(updates)
	if result.Error != nil {
		return errors.Join(cleanupErr, result.Error)
	}
	if result.RowsAffected == 0 {
		return errors.Join(cleanupErr, errors.New("asset review cleanup lease changed"))
	}
	return cleanupErr
}

func assetReviewCleanupRetryDelay(attempt int32) time.Duration {
	delay := time.Minute
	for current := int32(1); current < attempt && delay < time.Hour; current++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}
