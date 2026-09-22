package canvas

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type canvasRow struct {
	ID                          persistenceid.UUID `gorm:"primaryKey"`
	TenantID                    string             `gorm:"size:64;not null;index:idx_canvases_scope,priority:1"`
	WorkspaceID                 *string            `gorm:"size:64;index:idx_canvases_scope,priority:2"`
	ProjectID                   persistenceid.UUID `gorm:"not null;index:idx_canvases_scope,priority:3;uniqueIndex:uniq_canvases_project_name_deleted_at,priority:1"`
	Name                        string             `gorm:"size:80;not null;uniqueIndex:uniq_canvases_project_name_deleted_at,priority:2"`
	CoverImagePath              *string            `gorm:"type:varchar(128)"`
	CoverImageID                *persistenceid.UUID
	CoverImageSHA256            *string               `gorm:"type:varchar(64)"`
	CoverImageContentType       *string               `gorm:"type:varchar(32)"`
	CoverImageSizeBytes         int64                 `gorm:"not null;default:0"`
	CanvasNodeCount             int32                 `gorm:"not null;default:0"`
	SelectedVideoDurationMillis int64                 `gorm:"not null;default:0"`
	DefaultView                 int16                 `gorm:"not null;default:1"`
	Revision                    int64                 `gorm:"not null;default:1"`
	CreatedBy                   string                `gorm:"size:64;not null;index:idx_canvases_creator"`
	CreatedAt                   time.Time             `gorm:"not null"`
	UpdatedAt                   time.Time             `gorm:"not null;index"`
	DeletedAt                   soft_delete.DeletedAt `gorm:"softDelete:milli;index;uniqueIndex:uniq_canvases_project_name_deleted_at,priority:3"`
}

func (canvasRow) TableName() string { return "canvases" }

func Models() []any {
	return []any{&canvasRow{}}
}
