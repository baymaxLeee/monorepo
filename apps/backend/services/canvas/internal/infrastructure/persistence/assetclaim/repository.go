package assetclaim

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	application "github.com/example/monorepo/canvas/internal/application/assetclaim"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (repository *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, repository.db)
}

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
	return repository.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var current intentRow
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"tenant_id = ? AND workspace_id = ? AND owner_type = ? AND owner_id = ? AND slot = ?",
			intent.TenantID, intent.WorkspaceID, intent.OwnerType, intent.OwnerID, intent.Slot,
		).First(&current).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			row := rowFromIntent(intent, now)
			return tx.Create(&row).Error
		}
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
		return tx.Model(&current).Updates(map[string]any{
			"tenant_id": intent.TenantID, "workspace_id": intent.WorkspaceID,
			"asset_id": intent.AssetID, "revision_id": intent.RevisionID, "kind": intent.Kind,
			"generation": intent.Generation, "desired_state": intent.DesiredState, "expires_at": intent.ExpiresAt,
			"delivered_at": nil, "next_attempt_at": now, "lease_until": nil,
			"state_version": current.StateVersion + 1, "attempts": 0, "last_error": "", "updated_at": now,
		}).Error
	})
}

func (repository *Repository) ClaimDue(ctx context.Context, now, leaseUntil time.Time, limit int) ([]application.Intent, error) {
	if limit <= 0 {
		return []application.Intent{}, nil
	}
	claimed := make([]application.Intent, 0, limit)
	err := repository.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []intentRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("delivered_at IS NULL AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)", now, now).
			Order("next_attempt_at ASC, updated_at ASC, tenant_id ASC, workspace_id ASC, owner_type ASC, owner_id ASC, slot ASC").Limit(limit).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			update := tx.Model(&intentRow{}).Where(
				"tenant_id = ? AND workspace_id = ? AND owner_type = ? AND owner_id = ? AND slot = ? AND state_version = ? AND delivered_at IS NULL",
				row.TenantID, row.WorkspaceID, row.OwnerType, row.OwnerID, row.Slot, row.StateVersion,
			).Updates(map[string]any{"lease_until": leaseUntil, "state_version": row.StateVersion + 1})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				continue
			}
			row.LeaseUntil = &leaseUntil
			row.StateVersion++
			claimed = append(claimed, intentFromRow(row))
		}
		return nil
	})
	return claimed, err
}

func (repository *Repository) MarkDelivered(ctx context.Context, intent application.Intent, now time.Time) (bool, error) {
	result := repository.db.WithContext(ctx).Model(&intentRow{}).Where(
		"tenant_id = ? AND workspace_id = ? AND owner_type = ? AND owner_id = ? AND slot = ? AND generation = ? AND desired_state = ? AND state_version = ? AND delivered_at IS NULL AND lease_until > ?",
		intent.TenantID, intent.WorkspaceID, intent.OwnerType, intent.OwnerID, intent.Slot, intent.Generation, intent.DesiredState, intent.StateVersion, now,
	).Updates(map[string]any{"delivered_at": now, "lease_until": nil, "state_version": intent.StateVersion + 1, "last_error": "", "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (repository *Repository) Reschedule(ctx context.Context, intent application.Intent, next time.Time, message string, now time.Time) (bool, error) {
	message = strings.TrimSpace(message)
	if len(message) > 512 {
		message = message[:512]
	}
	result := repository.db.WithContext(ctx).Model(&intentRow{}).Where(
		"tenant_id = ? AND workspace_id = ? AND owner_type = ? AND owner_id = ? AND slot = ? AND generation = ? AND desired_state = ? AND state_version = ? AND delivered_at IS NULL AND lease_until > ?",
		intent.TenantID, intent.WorkspaceID, intent.OwnerType, intent.OwnerID, intent.Slot, intent.Generation, intent.DesiredState, intent.StateVersion, now,
	).Updates(map[string]any{"next_attempt_at": next, "lease_until": nil, "state_version": intent.StateVersion + 1, "attempts": intent.Attempts + 1, "last_error": message, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func rowFromIntent(intent application.Intent, now time.Time) intentRow {
	return intentRow{
		OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot, TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID,
		AssetID: intent.AssetID, RevisionID: intent.RevisionID, Kind: intent.Kind, Generation: intent.Generation,
		DesiredState: intent.DesiredState, ExpiresAt: intent.ExpiresAt, NextAttemptAt: now, StateVersion: 1, CreatedAt: now, UpdatedAt: now,
	}
}

func intentFromRow(row intentRow) application.Intent {
	return application.Intent{
		TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, OwnerType: row.OwnerType, OwnerID: row.OwnerID, Slot: row.Slot,
		AssetID: row.AssetID, RevisionID: row.RevisionID, Kind: row.Kind, Generation: row.Generation, DesiredState: row.DesiredState,
		ExpiresAt: row.ExpiresAt, DeliveredAt: row.DeliveredAt, NextAttemptAt: row.NextAttemptAt, LeaseUntil: row.LeaseUntil,
		StateVersion: row.StateVersion, Attempts: row.Attempts, LastError: row.LastError, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}
