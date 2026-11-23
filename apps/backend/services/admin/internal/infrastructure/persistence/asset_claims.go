package persistence

import (
	"context"
	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AssetClaimIntentRepository struct{ Pool *pgxpool.Pool }

func (repository AssetClaimIntentRepository) ClaimDueAssetClaims(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.AssetClaimDelivery, error) {
	if limit <= 0 {
		return []application.AssetClaimDelivery{}, nil
	}
	rows, err := sqlc.New(repository.Pool).ClaimDueAssetClaims(ctx, sqlc.ClaimDueAssetClaimsParams{
		Now: now, Lease: leaseUntil, PageSize: int64(limit),
	})
	if err != nil {
		return nil, err
	}
	items := make([]application.AssetClaimDelivery, len(rows))
	for index, row := range rows {
		items[index] = application.AssetClaimDelivery{
			AssetClaim: application.AssetClaim{
				TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
				OwnerType: row.OwnerType, OwnerID: row.OwnerID, Slot: row.Slot,
				AssetID: row.AssetID, RevisionID: row.RevisionID, Kind: row.Kind, DesiredState: row.DesiredState,
			},
			Generation: row.Generation, StateVersion: row.StateVersion, AttemptCount: row.AttemptCount,
		}
	}
	return items, nil
}

func (repository AssetClaimIntentRepository) MarkAssetClaimDelivered(ctx context.Context, item application.AssetClaimDelivery, now time.Time) (bool, error) {
	count, err := sqlc.New(repository.Pool).MarkAssetClaimDelivered(ctx, sqlc.MarkAssetClaimDeliveredParams{
		Now: now, TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
		OwnerType: item.OwnerType, OwnerID: item.OwnerID, Slot: item.Slot,
		Generation: item.Generation, DesiredState: item.DesiredState, StateVersion: item.StateVersion,
	})
	return count == 1, err
}

func (repository AssetClaimIntentRepository) RescheduleAssetClaim(ctx context.Context, item application.AssetClaimDelivery, next time.Time, message string, now time.Time) (bool, error) {
	message = strings.TrimSpace(message)
	if len(message) > 512 {
		message = message[:512]
	}
	count, err := sqlc.New(repository.Pool).RescheduleAssetClaim(ctx, sqlc.RescheduleAssetClaimParams{
		NextAttemptAt: next, Message: &message, Now: now,
		TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
		OwnerType: item.OwnerType, OwnerID: item.OwnerID, Slot: item.Slot,
		Generation: item.Generation, DesiredState: item.DesiredState, StateVersion: item.StateVersion,
	})
	return count == 1, err
}
