package asset

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type assetRow struct {
	ID               persistenceid.UUID    `gorm:"primaryKey"`
	TenantID         string                `gorm:"size:64;not null;index:idx_assets_scope,priority:1"`
	WorkspaceID      *string               `gorm:"size:64;index:idx_assets_scope,priority:2"`
	OwnerType        int16                 `gorm:"not null;index:idx_assets_owner,priority:1;uniqueIndex:uniq_assets_owner_creation,priority:1"`
	OwnerID          persistenceid.UUID    `gorm:"not null;index:idx_assets_owner,priority:2;uniqueIndex:uniq_assets_owner_creation,priority:2"`
	CreationKey      *string               `gorm:"size:255;uniqueIndex:uniq_assets_owner_creation,priority:3"`
	SourceAssetID    string                `gorm:"column:source_asset_id;size:128;not null;index:idx_assets_source_revision,priority:1"`
	SourceRevisionID string                `gorm:"column:source_revision_id;size:64;not null;index:idx_assets_source_revision,priority:2"`
	FileName         string                `gorm:"size:512;not null"`
	MediaType        int16                 `gorm:"not null"`
	ContentType      string                `gorm:"size:128;not null"`
	SizeBytes        int64                 `gorm:"not null"`
	BillingClass     string                `gorm:"size:16;not null;default:''"`
	CreatedBy        string                `gorm:"size:64;not null;index:idx_assets_creator"`
	CreatedAt        time.Time             `gorm:"not null;index"`
	DeletedAt        soft_delete.DeletedAt `gorm:"softDelete:milli;index"`
}

func (assetRow) TableName() string { return "assets" }

type assetReferenceRow struct {
	AssetID   persistenceid.UUID    `gorm:"primaryKey;priority:1;index:idx_asset_references_owner,priority:4;index:idx_asset_references_updated,priority:2"`
	OwnerType string                `gorm:"size:60;not null;primaryKey;priority:2;index:idx_asset_references_owner,priority:1"`
	OwnerKey  string                `gorm:"size:60;not null;primaryKey;priority:3;index:idx_asset_references_owner,priority:2"`
	CreatedAt time.Time             `gorm:"not null"`
	UpdatedAt time.Time             `gorm:"not null;index:idx_asset_references_updated,priority:1"`
	DeletedAt soft_delete.DeletedAt `gorm:"softDelete:milli;not null;default:0;index:idx_asset_references_owner,priority:3"`
}

func (assetReferenceRow) TableName() string { return "asset_references" }

func Models() []any {
	return []any{&assetRow{}, &assetReferenceRow{}}
}
