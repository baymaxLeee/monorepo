package canvasnode

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type canvasnodeRow struct {
	ID               persistenceid.UUID `gorm:"primaryKey"`
	TenantID         string             `gorm:"size:64;not null;index:idx_canvas_nodes_scope,priority:1"`
	WorkspaceID      *string            `gorm:"size:64;index:idx_canvas_nodes_scope,priority:2"`
	ProjectID        persistenceid.UUID `gorm:"not null;index:idx_canvas_nodes_scope,priority:3"`
	CanvasID         persistenceid.UUID `gorm:"not null;index:idx_canvas_nodes_canvas,priority:1;index:idx_canvas_nodes_storyboard,priority:1"`
	Type             int16              `gorm:"not null;index:idx_canvas_nodes_type"`
	StoryboardRank   int64              `gorm:"not null;index:idx_canvas_nodes_storyboard,priority:3"`
	AssetID          *persistenceid.UUID
	ResourceID       *persistenceid.UUID `gorm:"index"`
	ResourceAssetID  *persistenceid.UUID `gorm:"index"`
	NodeData         []byte              `gorm:"type:json;not null"`
	Revision         int64               `gorm:"not null"`
	ActiveTaskRunID  *persistenceid.UUID
	SelectedOutputID *persistenceid.UUID
	SelectedAssetID  *persistenceid.UUID
	CreatedBy        string                `gorm:"size:64;not null"`
	UpdatedBy        string                `gorm:"size:64;not null;default:''"`
	CreatedAt        time.Time             `gorm:"not null"`
	UpdatedAt        time.Time             `gorm:"not null;index"`
	DeletedAt        soft_delete.DeletedAt `gorm:"softDelete:milli;index;index:idx_canvas_nodes_storyboard,priority:4"`
}

func (canvasnodeRow) TableName() string { return "canvas_nodes" }

func Models() []any {
	return []any{&canvasnodeRow{}}
}
