package resourceassetgeneration

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
)

type draftRow struct {
	ID              persistenceid.UUID    `gorm:"primaryKey"`
	TenantID        string                `gorm:"size:64;not null;index:idx_ra_image_drafts_scope,priority:1"`
	WorkspaceID     *string               `gorm:"size:64;index:idx_ra_image_drafts_scope,priority:2"`
	ResourceID      persistenceid.UUID    `gorm:"not null;index"`
	ResourceAssetID persistenceid.UUID    `gorm:"not null;uniqueIndex"`
	Prompt          string                `gorm:"type:mediumtext;not null"`
	ModelID         string                `gorm:"size:128;not null"`
	Resolution      string                `gorm:"size:16;not null"`
	AspectRatio     string                `gorm:"size:16;not null"`
	Watermark       bool                  `gorm:"not null"`
	Revision        int64                 `gorm:"not null"`
	ActiveTaskRunID *persistenceid.UUID   `gorm:"uniqueIndex"`
	CreatedBy       string                `gorm:"size:64;not null"`
	CreatedAt       time.Time             `gorm:"not null"`
	UpdatedAt       time.Time             `gorm:"not null"`
	DeletedAt       soft_delete.DeletedAt `gorm:"softDelete:milli;index:idx_ra_image_drafts_scope,priority:3"`
}

func (draftRow) TableName() string { return "resource_asset_image_generation_drafts" }

type uploadedReferenceRow struct {
	ID       uint64             `gorm:"primaryKey;autoIncrement"`
	DraftID  persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_raig_upload_pos,priority:1;uniqueIndex:uniq_raig_upload_asset,priority:1;index"`
	Position int32              `gorm:"not null;uniqueIndex:uniq_raig_upload_pos,priority:2"`
	AssetID  persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_raig_upload_asset,priority:2"`
}

func (uploadedReferenceRow) TableName() string {
	return "resource_asset_image_generation_uploaded_references"
}

type resourceReferenceRow struct {
	ID         uint64             `gorm:"primaryKey;autoIncrement"`
	DraftID    persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_raig_resource_pos,priority:1;uniqueIndex:uniq_raig_resource_slot,priority:1;index"`
	Position   int32              `gorm:"not null;uniqueIndex:uniq_raig_resource_pos,priority:2"`
	ResourceID persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_raig_resource_slot,priority:2;index"`
	SequenceNo int64              `gorm:"not null;uniqueIndex:uniq_raig_resource_slot,priority:3"`
}

func (resourceReferenceRow) TableName() string {
	return "resource_asset_image_generation_resource_references"
}

func Models() []any {
	return []any{&draftRow{}, &uploadedReferenceRow{}, &resourceReferenceRow{}}
}
