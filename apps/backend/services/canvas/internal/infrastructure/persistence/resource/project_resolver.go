package resource

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/plugin/soft_delete"

	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

type ProjectResolver struct{ db *gorm.DB }

func NewProjectResolver(db *gorm.DB) *ProjectResolver { return &ProjectResolver{db: db} }

func (r *ProjectResolver) Validate(ctx context.Context, scope applicationresource.Scope, projectID string) error {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return applicationresource.ErrProjectNotFound
	}
	query := r.db.WithContext(ctx).Model(&resourceProjectScopeRow{}).
		Where("id = ? AND tenant_id = ?", id, scope.TenantID)
	if scope.WorkspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *scope.WorkspaceID)
	}
	var row resourceProjectScopeRow
	if err = query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationresource.ErrProjectNotFound
		}
		return err
	}
	return nil
}

type resourceProjectScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	DeletedAt   soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (resourceProjectScopeRow) TableName() string { return "projects" }
