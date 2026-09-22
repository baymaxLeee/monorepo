package scopelifecycle

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type row struct {
	ID          string  `gorm:"size:64;primaryKey"`
	TenantID    string  `gorm:"size:255;not null"`
	WorkspaceID *string `gorm:"size:255"`
	ClosedAt    *time.Time
	CreatedAt   time.Time `gorm:"not null"`
}

func (row) TableName() string { return "scope_deletion_fences" }
func Models() []any           { return []any{&row{}} }

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// LockActive must run inside the writer's transaction. Shared locks permit
// concurrent writers; closing a scope waits for admitted writes to commit.
// Always check tenant first so a new workspace cannot escape tenant deletion.
func LockActive(db *gorm.DB, tenantID string, workspaceID *string) error {
	if tenantID == "" || workspaceID != nil && *workspaceID == "" {
		return gorm.ErrRecordNotFound
	}
	tenant, err := lock(db, tenantID, nil, "SHARE")
	if err != nil {
		return err
	}
	if tenant.ClosedAt != nil {
		return gorm.ErrRecordNotFound
	}
	if workspaceID == nil {
		return nil
	}
	workspace, err := lock(db, tenantID, workspaceID, "SHARE")
	if err != nil {
		return err
	}
	if workspace.ClosedAt != nil {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// Close commits before domain cleanup begins. The tombstone is never removed
// by cleanup or retries; identity identifiers are not reusable lifecycle slots.
func (r *Repository) Close(ctx context.Context, tenantID string, workspaceID *string) error {
	if tenantID == "" || workspaceID != nil && *workspaceID == "" {
		return errors.New("invalid deletion scope")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		current, err := lock(tx, tenantID, workspaceID, "UPDATE")
		if err != nil {
			return err
		}
		if current.ClosedAt != nil {
			return nil
		}
		return tx.Model(&row{}).Where("id = ?", current.ID).Update("closed_at", time.Now().UTC()).Error
	})
}

func lock(db *gorm.DB, tenantID string, workspaceID *string, strength string) (row, error) {
	key := tenantID + "\x00tenant"
	if workspaceID != nil {
		key = tenantID + "\x00workspace\x00" + *workspaceID
	}
	hash := sha256.Sum256([]byte(key))
	id := hex.EncodeToString(hash[:])
	var current row
	read := func() error {
		return db.Clauses(clause.Locking{Strength: strength}).Where("id = ?", id).First(&current).Error
	}
	err := read()
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return current, err
	}
	created := row{ID: id, TenantID: tenantID, WorkspaceID: workspaceID}
	if err = db.Clauses(clause.OnConflict{DoNothing: true}).Create(&created).Error; err != nil {
		return row{}, err
	}
	err = read()
	return current, err
}
