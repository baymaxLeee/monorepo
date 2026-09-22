package project

import (
	"time"

	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type projectRow struct {
	ID                          persistenceid.UUID `gorm:"primaryKey"`
	TenantID                    string             `gorm:"size:64;not null;index:idx_projects_scope,priority:1;uniqueIndex:uniq_projects_tenant_name_deleted_at,priority:1"`
	WorkspaceID                 *string            `gorm:"size:64;index:idx_projects_scope,priority:2"`
	Name                        string             `gorm:"size:80;not null;uniqueIndex:uniq_projects_tenant_name_deleted_at,priority:2"`
	CreatedBy                   string             `gorm:"size:64;not null"`
	CoverImagePath              *string            `gorm:"type:varchar(128)"`
	CoverImageID                *persistenceid.UUID
	CoverImageSHA256            *string               `gorm:"type:varchar(64)"`
	CoverImageSizeBytes         int64                 `gorm:"not null;default:0"`
	CanvasCount                 int32                 `gorm:"not null;default:0"`
	SelectedVideoDurationMillis int64                 `gorm:"not null;default:0"`
	ResourceCount               int32                 `gorm:"not null;default:0"`
	CreatedAt                   time.Time             `gorm:"not null"`
	UpdatedAt                   time.Time             `gorm:"not null;index"`
	DeletedAt                   soft_delete.DeletedAt `gorm:"softDelete:milli;index;uniqueIndex:uniq_projects_tenant_name_deleted_at,priority:3"`
}

func (projectRow) TableName() string { return "projects" }

type projectMemberRow struct {
	ID          uint64                `gorm:"primaryKey;autoIncrement"`
	TenantID    string                `gorm:"size:64;not null;index:idx_project_members_user,priority:1"`
	WorkspaceID *string               `gorm:"size:64;index:idx_project_members_user,priority:2"`
	ProjectID   persistenceid.UUID    `gorm:"not null;index:idx_project_members_project,priority:1"`
	UserID      string                `gorm:"size:64;not null;index:idx_project_members_user,priority:3"`
	CreatedAt   time.Time             `gorm:"not null"`
	DeletedAt   soft_delete.DeletedAt `gorm:"softDelete:milli;index:idx_project_members_user,priority:4;index:idx_project_members_project,priority:2"`
}

func (projectMemberRow) TableName() string { return "project_members" }

func Models() []any {
	return []any{&projectRow{}, &projectMemberRow{}}
}
