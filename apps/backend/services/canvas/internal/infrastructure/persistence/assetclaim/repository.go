package assetclaim

import (
	"context"
	"errors"
	"strings"
	"time"

	application "github.com/example/monorepo/canvas/internal/application/assetclaim"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (repository *Repository) EnsureActive(ctx context.Context, intent application.Intent, now time.Time) error {
	intent.DesiredState = application.DesiredActive
	return repository.ensure(ctx, intent, now)
}

func (repository *Repository) EnsureReleased(ctx context.Context, intent application.Intent, now time.Time) error {
	intent.DesiredState = application.DesiredReleased
	return repository.ensure(ctx, intent, now)
}

func (repository *Repository) ensure(ctx context.Context, intent application.Intent, now time.Time) error {
	if !intent.Valid() || now.IsZero() {
		return errors.New("invalid asset claim intent")
	}
	return repository.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := repository.db.Queries(ctx)
		inserted, err := q.InsertClaimIntent(ctx, sqlc.InsertClaimIntentParams{
			TenantID:     intent.TenantID,
			WorkspaceID:  intent.WorkspaceID,
			OwnerType:    intent.OwnerType,
			OwnerID:      intent.OwnerID,
			Slot:         intent.Slot,
			AssetID:      intent.AssetID,
			RevisionID:   intent.RevisionID,
			Kind:         intent.Kind,
			Generation:   intent.Generation,
			DesiredState: intent.DesiredState,
			ExpiresAt:    intent.ExpiresAt,
			Now:          now,
		})
		if err != nil || inserted == 1 {
			return err
		}
		current, err := q.LockClaimIntent(ctx, sqlc.LockClaimIntentParams{
			TenantID:    intent.TenantID,
			WorkspaceID: intent.WorkspaceID,
			OwnerType:   intent.OwnerType,
			OwnerID:     intent.OwnerID,
			Slot:        intent.Slot,
		})
		if err != nil {
			return err
		}
		if current.Generation > intent.Generation {
			return nil
		}
		if current.Generation == intent.Generation {
			if current.TenantID != intent.TenantID || current.WorkspaceID != intent.WorkspaceID ||
				current.AssetID != intent.AssetID || current.RevisionID != intent.RevisionID ||
				current.Kind != intent.Kind {
				return application.ErrConflict
			}
			if current.DesiredState == intent.DesiredState {
				return nil
			}
		}
		return q.ReplaceClaimIntent(ctx, sqlc.ReplaceClaimIntentParams{
			AssetID:      intent.AssetID,
			RevisionID:   intent.RevisionID,
			Kind:         intent.Kind,
			Generation:   intent.Generation,
			DesiredState: intent.DesiredState,
			ExpiresAt:    intent.ExpiresAt,
			Now:          now,
			TenantID:     intent.TenantID,
			WorkspaceID:  intent.WorkspaceID,
			OwnerType:    intent.OwnerType,
			OwnerID:      intent.OwnerID,
			Slot:         intent.Slot,
		})
	})
}

func (repository *Repository) ClaimDue(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.Intent, error) {
	if limit <= 0 {
		return []application.Intent{}, nil
	}
	rows, err := repository.db.Queries(ctx).ClaimDueAssetIntents(ctx, sqlc.ClaimDueAssetIntentsParams{
		Now:      now,
		Lease:    leaseUntil,
		PageSize: int64(limit),
	})
	if err != nil {
		return nil, err
	}
	claimed := make([]application.Intent, len(rows))
	for i, row := range rows {
		claimed[i] = intentFromRow(row)
	}
	return claimed, nil
}

func (repository *Repository) MarkDelivered(ctx context.Context, intent application.Intent, now time.Time) (bool, error) {
	count, err := repository.db.Queries(ctx).DeliverClaimIntent(ctx, sqlc.DeliverClaimIntentParams{
		Now:          now,
		TenantID:     intent.TenantID,
		WorkspaceID:  intent.WorkspaceID,
		OwnerType:    intent.OwnerType,
		OwnerID:      intent.OwnerID,
		Slot:         intent.Slot,
		Generation:   intent.Generation,
		DesiredState: intent.DesiredState,
		StateVersion: intent.StateVersion,
	})
	return count == 1, err
}

func (repository *Repository) Reschedule(ctx context.Context, intent application.Intent, next time.Time, message string, now time.Time) (bool, error) {
	message = strings.TrimSpace(message)
	if len(message) > 512 {
		message = message[:512]
	}
	count, err := repository.db.Queries(ctx).RetryClaimIntent(ctx, sqlc.RetryClaimIntentParams{
		NextAttemptAt: next,
		Message:       message,
		Now:           now,
		TenantID:      intent.TenantID,
		WorkspaceID:   intent.WorkspaceID,
		OwnerType:     intent.OwnerType,
		OwnerID:       intent.OwnerID,
		Slot:          intent.Slot,
		Generation:    intent.Generation,
		DesiredState:  intent.DesiredState,
		StateVersion:  intent.StateVersion,
	})
	return count == 1, err
}

func intentFromRow(row sqlc.ClaimDueAssetIntentsRow) application.Intent {
	return application.Intent{
		TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, OwnerType: row.OwnerType, OwnerID: row.OwnerID, Slot: row.Slot,
		AssetID: row.AssetID, RevisionID: row.RevisionID, Kind: row.Kind, Generation: row.Generation, DesiredState: row.DesiredState,
		ExpiresAt: row.ExpiresAt, DeliveredAt: row.DeliveredAt, NextAttemptAt: row.NextAttemptAt, LeaseUntil: row.LeaseUntil,
		StateVersion: row.StateVersion, Attempts: row.Attempts, LastError: row.LastError, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}
