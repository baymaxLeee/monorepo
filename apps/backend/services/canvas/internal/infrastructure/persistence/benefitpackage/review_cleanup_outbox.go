package benefitpackage

import (
	"context"
	"time"

	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
)

func (r *Repository) ClaimReviewCleanup(ctx context.Context, now, leaseUntil time.Time, limit int) ([]applicationpackage.ReviewCleanupOutbox, error) {
	if limit <= 0 {
		return []applicationpackage.ReviewCleanupOutbox{}, nil
	}
	rows, err := r.db.Queries(ctx).ClaimReviewCleanupJobs(ctx, sqlc.ClaimReviewCleanupJobsParams{
		NowTs:     now,
		BatchSize: int32(limit),
		LeaseEnd:  leaseUntil,
	})
	if err != nil {
		return nil, err
	}
	items := make([]applicationpackage.ReviewCleanupOutbox, 0, len(rows))
	for _, row := range rows {
		items = append(items, reviewCleanupFromRow(row))
	}
	return items, nil
}

func (r *Repository) CompleteReviewCleanup(ctx context.Context, item applicationpackage.ReviewCleanupOutbox, now time.Time) (bool, error) {
	id, err := persistenceid.Parse(item.ReviewID)
	if err != nil {
		return false, err
	}
	n, err := r.db.Queries(ctx).CompleteReviewCleanupJob(ctx, sqlc.CompleteReviewCleanupJobParams{
		ReviewID:     id.String(),
		StateVersion: item.StateVersion,
		NowTs:        now,
	})
	return n == 1, err
}

func (r *Repository) RescheduleReviewCleanup(ctx context.Context, item applicationpackage.ReviewCleanupOutbox, next time.Time, message string, now time.Time) (bool, error) {
	id, err := persistenceid.Parse(item.ReviewID)
	if err != nil {
		return false, err
	}
	n, err := r.db.Queries(ctx).RescheduleReviewCleanupJob(ctx, sqlc.RescheduleReviewCleanupJobParams{
		NextAttemptAt: next,
		LastError:     message,
		NowTs:         now,
		ReviewID:      id.String(),
		StateVersion:  item.StateVersion,
	})
	return n == 1, err
}

func (r *Repository) MarkReviewCleanupDead(ctx context.Context, item applicationpackage.ReviewCleanupOutbox, message string, now time.Time) (bool, error) {
	id, err := persistenceid.Parse(item.ReviewID)
	if err != nil {
		return false, err
	}
	n, err := r.db.Queries(ctx).MarkReviewCleanupJobDead(ctx, sqlc.MarkReviewCleanupJobDeadParams{
		LastError:    message,
		NowTs:        now,
		ReviewID:     id.String(),
		StateVersion: item.StateVersion,
	})
	return n == 1, err
}

func reviewCleanupFromRow(row sqlc.ClaimReviewCleanupJobsRow) applicationpackage.ReviewCleanupOutbox {
	return applicationpackage.ReviewCleanupOutbox{
		ReviewID: row.ReviewID, AssetID: row.AssetID, PackageID: row.PackageID, TenantID: row.TenantID,
		WorkspaceID: &row.WorkspaceID, ProviderAssetID: row.ProviderAssetID, ReservationID: row.ReservationID,
		NextAttemptAt: row.NextAttemptAt.UTC(), LeaseUntil: row.LeaseUntil, StateVersion: row.StateVersion,
		Attempts: row.Attempts, Status: row.Status, LastError: row.LastError, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(),
	}
}
