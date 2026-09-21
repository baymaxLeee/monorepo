package deletion

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/mysqlcompat"
	transaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	application "github.com/example/monorepo/canvas/internal/server/application/deletion"
)

type jobRow struct {
	ID            string          `gorm:"size:64;primaryKey"`
	TenantID      string          `gorm:"size:255;not null;index"`
	Kind          string          `gorm:"size:64;not null"`
	Payload       json.RawMessage `gorm:"type:json;not null"`
	NextAttemptAt time.Time       `gorm:"not null;index:idx_deletion_jobs_due,priority:2"`
	LeaseUntil    *time.Time
	StateVersion  int64      `gorm:"not null"`
	Attempts      int32      `gorm:"not null"`
	CompletedAt   *time.Time `gorm:"index:idx_deletion_jobs_due,priority:1"`
	LastError     string     `gorm:"type:text;not null"`
	CreatedAt     time.Time  `gorm:"not null"`
	UpdatedAt     time.Time  `gorm:"not null"`
}

func (jobRow) TableName() string { return "deletion_jobs" }
func Models() []any              { return []any{&jobRow{}} }

type Repository struct {
	db                     *gorm.DB
	mysqlCompatibleVersion int
}

func NewRepository(db *gorm.DB, mysqlCompatibleVersion ...int) *Repository {
	version := 5
	if len(mysqlCompatibleVersion) > 0 {
		version = mysqlCompatibleVersion[0]
	}
	return &Repository{db: db, mysqlCompatibleVersion: version}
}

func (r *Repository) Enqueue(ctx context.Context, job application.Job) error {
	row := jobRow{ID: job.ID, TenantID: job.TenantID, Kind: job.Kind, Payload: job.Payload, NextAttemptAt: job.NextAttemptAt, StateVersion: 1}
	return transaction.DB(ctx, r.db).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *Repository) Claim(ctx context.Context, now, until time.Time, limit int) ([]application.Job, error) {
	var jobs []application.Job
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []jobRow
		if err := tx.Clauses(mysqlcompat.ForUpdate(r.mysqlCompatibleVersion)).
			Where("completed_at IS NULL AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)", now, now).
			Order("next_attempt_at ASC, id ASC").Limit(limit).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			update := tx.Model(&jobRow{}).Where(
				"id = ? AND state_version = ? AND completed_at IS NULL AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until <= ?)",
				row.ID, row.StateVersion, now, now,
			).
				Updates(map[string]any{"lease_until": until, "state_version": row.StateVersion + 1})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return errors.New("deletion job claim lost")
			}
			jobs = append(jobs, application.Job{ID: row.ID, TenantID: row.TenantID, Kind: row.Kind, Payload: row.Payload, LeaseUntil: &until, StateVersion: row.StateVersion + 1, Attempts: row.Attempts})
		}
		return nil
	})
	return jobs, err
}

func (r *Repository) Finish(ctx context.Context, job application.Job, now time.Time, failure error) error {
	values := map[string]any{"lease_until": nil, "state_version": job.StateVersion + 1, "attempts": job.Attempts + 1, "last_error": ""}
	if failure == nil {
		values["completed_at"] = now
	} else {
		// Persist only a safe category; raw causes belong to structured logs.
		values["last_error"] = "deletion effect failed; retry pending"
		delay := time.Minute
		for attempt := int32(0); attempt < job.Attempts && delay < time.Hour; attempt++ {
			delay *= 2
		}
		if delay > time.Hour {
			delay = time.Hour
		}
		values["next_attempt_at"] = now.Add(delay)
	}
	update := r.db.WithContext(ctx).Model(&jobRow{}).
		Where("id = ? AND state_version = ? AND completed_at IS NULL AND lease_until > ?", job.ID, job.StateVersion, now).Updates(values)
	if update.Error != nil {
		return update.Error
	}
	if update.RowsAffected != 1 {
		return errors.New("deletion job completion lease lost")
	}
	return nil
}
