package defaultmodel

import "time"

type defaultModelRow struct {
	TenantID string `gorm:"column:tenant_id;type:varchar(191);primaryKey"`
	Config   []byte `gorm:"column:config;type:json;not null"`
	Revision int64  `gorm:"column:revision;not null"`
	// Retained for compatibility with the existing 3.1.0 database schema; migrations never import from IAM.
	ImportedFromIAM bool      `gorm:"column:imported_from_iam;not null"`
	CreatedBy       string    `gorm:"column:created_by;type:varchar(191);not null"`
	UpdatedBy       string    `gorm:"column:updated_by;type:varchar(191);not null"`
	CreatedAt       time.Time `gorm:"column:created_at;not null"`
	UpdatedAt       time.Time `gorm:"column:updated_at;not null"`
}

func (defaultModelRow) TableName() string { return "default_model_configs" }

func Models() []any { return []any{&defaultModelRow{}} }
