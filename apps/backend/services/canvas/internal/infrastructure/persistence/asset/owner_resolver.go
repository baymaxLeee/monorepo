package asset

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type OwnerResolver struct {
	db *gorm.DB
}

func NewOwnerResolver(db *gorm.DB) *OwnerResolver {
	return &OwnerResolver{db: db}
}

func (r *OwnerResolver) Validate(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
) error {
	switch ownerType {
	case domainasset.OwnerProject:
		return findProjectOwner(persistencetransaction.DB(ctx, r.db), scope.TenantID, scope.WorkspaceID, ownerID, false)
	case domainasset.OwnerResource:
		return findResourceOwner(persistencetransaction.DB(ctx, r.db), scope.TenantID, scope.WorkspaceID, ownerID, false)
	default:
		return applicationasset.ErrOwnerNotFound
	}
}

func (r *OwnerResolver) ValidateForUpdate(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
) error {
	switch ownerType {
	case domainasset.OwnerProject:
		return findProjectOwner(persistencetransaction.DB(ctx, r.db), scope.TenantID, scope.WorkspaceID, ownerID, true)
	case domainasset.OwnerResource:
		return findResourceOwner(persistencetransaction.DB(ctx, r.db), scope.TenantID, scope.WorkspaceID, ownerID, true)
	default:
		return applicationasset.ErrOwnerNotFound
	}
}

func findProjectOwner(db *gorm.DB, tenantID string, workspaceID *string, ownerID string, lock bool) error {
	id, err := persistenceid.Parse(ownerID)
	if err != nil {
		return applicationasset.ErrOwnerNotFound
	}
	var project projectScopeRow
	query := db.Select("id").Where("id = ? AND tenant_id = ?", id, tenantID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if workspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *workspaceID)
	}
	if err := query.First(&project).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationasset.ErrOwnerNotFound
		}
		return err
	}
	return nil
}

type projectScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	DeletedAt   soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (projectScopeRow) TableName() string { return "projects" }

func findResourceOwner(db *gorm.DB, tenantID string, workspaceID *string, ownerID string, lock bool) error {
	id, err := persistenceid.Parse(ownerID)
	if err != nil {
		return applicationasset.ErrOwnerNotFound
	}
	var resource resourceScopeRow
	query := db.Model(&resourceScopeRow{}).
		Select("resources.id").
		Joins("JOIN projects p ON p.id = resources.owner_id AND p.deleted_at = 0").
		Where("resources.id = ? AND resources.tenant_id = ? AND resources.owner_type = ?", id, tenantID, 1)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if workspaceID == nil {
		query = query.Where("resources.workspace_id IS NULL")
	} else {
		query = query.Where("resources.workspace_id = ?", *workspaceID)
	}
	if err := query.First(&resource).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationasset.ErrOwnerNotFound
		}
		return err
	}
	return nil
}

type resourceScopeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	OwnerType   int16
	OwnerID     persistenceid.UUID
	DeletedAt   soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (resourceScopeRow) TableName() string { return "resources" }
