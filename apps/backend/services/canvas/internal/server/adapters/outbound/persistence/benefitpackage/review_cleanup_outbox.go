package benefitpackage

import (
	"context"
	"time"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationpackage "github.com/example/monorepo/canvas/internal/server/application/benefitpackage"
)

func (r *Repository) ClaimReviewCleanup(ctx context.Context, now, leaseUntil time.Time, limit int) ([]applicationpackage.ReviewCleanupOutbox, error) {
	if limit <= 0 {
		return []applicationpackage.ReviewCleanupOutbox{}, nil
	}
	db := persistencetransaction.DB(ctx, r.db)
	var candidates []assetReviewCleanupOutboxRow
	if err := db.Where("status = ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)", applicationpackage.ReviewCleanupStatusPending, now, now).
		Order("next_attempt_at ASC").Order("review_id ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	claimed := make([]applicationpackage.ReviewCleanupOutbox, 0, len(candidates))
	for _, row := range candidates {
		update := db.Model(&assetReviewCleanupOutboxRow{}).Where(
			"review_id = ? AND status = ? AND state_version = ? AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
			row.ReviewID, applicationpackage.ReviewCleanupStatusPending, row.StateVersion, now, now,
		).Updates(map[string]any{"lease_until": leaseUntil, "state_version": row.StateVersion + 1, "updated_at": now})
		if update.Error != nil {
			return nil, update.Error
		}
		if update.RowsAffected != 1 {
			continue
		}
		row.LeaseUntil = &leaseUntil
		row.StateVersion++
		row.UpdatedAt = now
		claimed = append(claimed, reviewCleanupFromRow(row))
	}
	return claimed, nil
}

func (r *Repository) CompleteReviewCleanup(ctx context.Context, item applicationpackage.ReviewCleanupOutbox, now time.Time) (bool, error) {
	reviewID, err := persistenceid.Parse(item.ReviewID)
	if err != nil {
		return false, err
	}
	update := persistencetransaction.DB(ctx, r.db).Where(
		"review_id = ? AND status = ? AND state_version = ? AND lease_until > ?", reviewID, applicationpackage.ReviewCleanupStatusPending, item.StateVersion, now,
	).Delete(&assetReviewCleanupOutboxRow{})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func (r *Repository) RescheduleReviewCleanup(ctx context.Context, item applicationpackage.ReviewCleanupOutbox, next time.Time, message string, now time.Time) (bool, error) {
	reviewID, err := persistenceid.Parse(item.ReviewID)
	if err != nil {
		return false, err
	}
	update := persistencetransaction.DB(ctx, r.db).Model(&assetReviewCleanupOutboxRow{}).Where(
		"review_id = ? AND status = ? AND state_version = ? AND lease_until > ?", reviewID, applicationpackage.ReviewCleanupStatusPending, item.StateVersion, now,
	).Updates(map[string]any{
		"next_attempt_at": next, "lease_until": nil, "state_version": item.StateVersion + 1,
		"attempts": item.Attempts + 1, "last_error": message, "updated_at": now,
	})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func (r *Repository) MarkReviewCleanupDead(ctx context.Context, item applicationpackage.ReviewCleanupOutbox, message string, now time.Time) (bool, error) {
	reviewID, err := persistenceid.Parse(item.ReviewID)
	if err != nil {
		return false, err
	}
	update := persistencetransaction.DB(ctx, r.db).Model(&assetReviewCleanupOutboxRow{}).Where(
		`review_id = ? AND status = ? AND state_version = ? AND lease_until > ?`,
		reviewID, applicationpackage.ReviewCleanupStatusPending, item.StateVersion, now,
	).Updates(map[string]any{
		"status": applicationpackage.ReviewCleanupStatusDead, "lease_until": nil,
		"state_version": item.StateVersion + 1, "attempts": item.Attempts + 1,
		"last_error": message, "updated_at": now,
	})
	if update.Error != nil {
		return false, update.Error
	}
	return update.RowsAffected == 1, nil
}

func reviewCleanupFromRow(row assetReviewCleanupOutboxRow) applicationpackage.ReviewCleanupOutbox {
	return applicationpackage.ReviewCleanupOutbox{
		ReviewID: row.ReviewID.String(), AssetID: row.AssetID.String(), PackageID: row.PackageID.String(), TenantID: row.TenantID,
		ProviderAssetID: row.ProviderAssetID, ProjectName: row.ProjectName,
		EncryptedAccessKeyID: row.EncryptedAccessKeyID, EncryptedSecretAccessKey: row.EncryptedSecretAccessKey,
		QuotaReservationID: row.QuotaReservationID,
		NextAttemptAt:      row.NextAttemptAt.UTC(), LeaseUntil: row.LeaseUntil, StateVersion: row.StateVersion,
		Attempts: row.Attempts, Status: row.Status, LastError: row.LastError, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(),
	}
}
