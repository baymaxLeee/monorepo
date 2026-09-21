package resource

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
)

type resourceRow struct {
	ID                     persistenceid.UUID `gorm:"primaryKey"`
	TenantID               string             `gorm:"size:64;not null;index:idx_resources_scope,priority:1"`
	WorkspaceID            *string            `gorm:"size:64;index:idx_resources_scope,priority:2"`
	OwnerType              int16              `gorm:"not null;uniqueIndex:uniq_resources_owner_name_deleted_at,priority:1;index:idx_resources_owner,priority:1"`
	OwnerID                persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_resources_owner_name_deleted_at,priority:2;index:idx_resources_owner,priority:2;index:idx_resources_owner_type,priority:1"`
	Type                   int16              `gorm:"not null;index:idx_resources_owner_type,priority:2"`
	Name                   string             `gorm:"size:128;not null;uniqueIndex:uniq_resources_owner_name_deleted_at,priority:3"`
	Description            string             `gorm:"size:800;not null;default:''"`
	PrimaryResourceAssetID *persistenceid.UUID
	Revision               int64                 `gorm:"not null"`
	ResourceAssetCount     int32                 `gorm:"not null;default:0"`
	CreatedBy              string                `gorm:"size:64;not null"`
	CreatedAt              time.Time             `gorm:"not null;index"`
	UpdatedAt              time.Time             `gorm:"not null;index"`
	DeletedAt              soft_delete.DeletedAt `gorm:"softDelete:milli;index;uniqueIndex:uniq_resources_owner_name_deleted_at,priority:4"`
}

func (resourceRow) TableName() string { return "resources" }

type projectResourceRelationRow struct {
	ID         uint64                `gorm:"primaryKey;autoIncrement"`
	ProjectID  persistenceid.UUID    `gorm:"not null;uniqueIndex:uniq_project_resource_rel_active,priority:1;index:idx_project_resource_rel_project"`
	ResourceID persistenceid.UUID    `gorm:"not null;uniqueIndex:uniq_project_resource_rel_active,priority:2;index:idx_project_resource_rel_resource"`
	CreatedAt  time.Time             `gorm:"not null"`
	DeletedAt  soft_delete.DeletedAt `gorm:"softDelete:milli;uniqueIndex:uniq_project_resource_rel_active,priority:3;index"`
}

func (projectResourceRelationRow) TableName() string { return "project_resource_rel" }

type resourceAssetRow struct {
	ID                     persistenceid.UUID    `gorm:"primaryKey"`
	ResourceID             persistenceid.UUID    `gorm:"not null;index:idx_resource_assets_resource,priority:1;uniqueIndex:uniq_resource_asset_name_active,priority:1;uniqueIndex:uniq_resource_asset_sequence,priority:1"`
	Name                   string                `gorm:"size:128;not null;uniqueIndex:uniq_resource_asset_name_active,priority:2"`
	SequenceNo             int64                 `gorm:"not null;uniqueIndex:uniq_resource_asset_sequence,priority:2"`
	SourceType             int16                 `gorm:"not null"`
	CurrentAssetID         *persistenceid.UUID   `gorm:"index"`
	ImageGenerationDraftID *persistenceid.UUID   `gorm:"uniqueIndex"`
	MediaType              int16                 `gorm:"not null"`
	Revision               int64                 `gorm:"not null"`
	CreatedAt              time.Time             `gorm:"not null;index"`
	UpdatedAt              time.Time             `gorm:"not null"`
	DeletedAt              soft_delete.DeletedAt `gorm:"softDelete:milli;index:idx_resource_assets_resource,priority:2;uniqueIndex:uniq_resource_asset_name_active,priority:3"`
}

func (resourceAssetRow) TableName() string { return "resource_assets" }

type resourceAssetRevisionRow struct {
	ID              uint64             `gorm:"primaryKey;autoIncrement"`
	ResourceAssetID persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_resource_asset_revisions_no,priority:1;uniqueIndex:uniq_resource_asset_revisions_asset,priority:1;index:idx_resource_asset_revisions_resource_asset"`
	AssetID         persistenceid.UUID `gorm:"not null;uniqueIndex:uniq_resource_asset_revisions_asset,priority:2"`
	MediaType       int16              `gorm:"not null"`
	RevisionNo      int64              `gorm:"not null;uniqueIndex:uniq_resource_asset_revisions_no,priority:2"`
	CreatedAt       time.Time          `gorm:"not null"`
}

func (resourceAssetRevisionRow) TableName() string { return "resource_asset_revisions" }

func Models() []any {
	return []any{&resourceRow{}, &projectResourceRelationRow{}, &resourceAssetRow{}, &resourceAssetRevisionRow{}}
}
