package task

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

// CanExecuteTaskRun is the execution-time counterpart of request-time parent
// validation. Parent rows are the immediate visibility fence while descendant
// cleanup is still waiting in deletion_jobs.
func (r *Repository) CanExecuteTaskRun(ctx context.Context, run domaintask.TaskRun) (bool, error) {
	if run.Terminal() || run.HiddenAt != nil {
		return false, nil
	}
	switch run.SubjectType {
	case domaintask.SubjectTypeCanvasNode:
		return r.activeCanvasNode(ctx, run, run.SubjectID)
	case domaintask.SubjectTypeCanvas:
		return r.activeCanvas(ctx, run, run.SubjectID)
	case domaintask.SubjectTypeImageGeneration:
		return r.activeImageGenerationTarget(ctx, run)
	case domaintask.SubjectTypeAsset:
		return r.activeAssetOwner(ctx, run)
	default:
		return false, nil
	}
}

func (r *Repository) activeCanvasNode(ctx context.Context, run domaintask.TaskRun, nodeID string) (bool, error) {
	id, err := persistenceid.Parse(nodeID)
	if err != nil {
		return false, nil
	}
	query := r.dbFor(ctx).Table("canvas_nodes AS n").
		Select("n.id").
		Joins("JOIN canvases AS c ON c.id = n.canvas_id AND c.project_id = n.project_id AND c.deleted_at = 0").
		Joins("JOIN projects AS p ON p.id = n.project_id AND p.deleted_at = 0").
		Where("n.id = ? AND n.deleted_at = 0 AND n.tenant_id = ?", id, run.TenantID)
	query = admissionWorkspace(query, "n.workspace_id", run.WorkspaceID)
	return takeAdmission(query)
}

func (r *Repository) activeCanvas(ctx context.Context, run domaintask.TaskRun, canvasID string) (bool, error) {
	id, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, nil
	}
	query := r.dbFor(ctx).Table("canvases AS c").
		Select("c.id").
		Joins("JOIN projects AS p ON p.id = c.project_id AND p.deleted_at = 0").
		Where("c.id = ? AND c.deleted_at = 0 AND c.tenant_id = ?", id, run.TenantID)
	query = admissionWorkspace(query, "c.workspace_id", run.WorkspaceID)
	return takeAdmission(query)
}

func (r *Repository) activeImageGenerationTarget(ctx context.Context, run domaintask.TaskRun) (bool, error) {
	taskRunID, err := persistenceid.Parse(run.ID)
	if err != nil {
		return false, nil
	}
	var target imageGenerationAdmissionRow
	query := r.dbFor(ctx).Table("image_generation_runs").
		Where("task_run_id = ? AND tenant_id = ?", taskRunID, run.TenantID)
	query = admissionWorkspace(query, "workspace_id", run.WorkspaceID)
	if err = query.Take(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if target.TargetID.String() != run.SubjectID {
		return false, nil
	}
	switch domainimagegeneration.TargetType(target.TargetType) {
	case domainimagegeneration.TargetCanvasNode:
		return r.activeCanvasNode(ctx, run, target.TargetID.String())
	case domainimagegeneration.TargetResourceAsset:
		query = r.dbFor(ctx).Table("resource_assets AS ra").
			Select("ra.id").
			Joins("JOIN resources AS res ON res.id = ra.resource_id AND res.deleted_at = 0").
			Joins("JOIN projects AS p ON p.id = res.owner_id AND res.owner_type = 1 AND p.deleted_at = 0").
			Where("ra.image_generation_draft_id = ? AND ra.deleted_at = 0 AND res.tenant_id = ?", target.TargetID, run.TenantID)
		query = admissionWorkspace(query, "res.workspace_id", run.WorkspaceID)
		return takeAdmission(query)
	default:
		return false, nil
	}
}

func (r *Repository) activeAssetOwner(ctx context.Context, run domaintask.TaskRun) (bool, error) {
	assetID, err := persistenceid.Parse(run.SubjectID)
	if err != nil {
		return false, nil
	}
	var asset assetAdmissionRow
	query := r.dbFor(ctx).Where("id = ? AND tenant_id = ?", assetID, run.TenantID)
	query = admissionWorkspace(query, "workspace_id", run.WorkspaceID)
	if err = query.Take(&asset).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	switch domainasset.OwnerType(asset.OwnerType) {
	case domainasset.OwnerOfficial:
		return true, nil
	case domainasset.OwnerProject:
		query = r.dbFor(ctx).Table("projects AS p").Select("p.id").
			Where("p.id = ? AND p.deleted_at = 0 AND p.tenant_id = ?", asset.OwnerID, run.TenantID)
		query = admissionWorkspace(query, "p.workspace_id", run.WorkspaceID)
		return takeAdmission(query)
	case domainasset.OwnerResource:
		query = r.dbFor(ctx).Table("resources AS res").
			Select("res.id").
			Joins("JOIN projects AS p ON p.id = res.owner_id AND res.owner_type = 1 AND p.deleted_at = 0").
			Where("res.id = ? AND res.deleted_at = 0 AND res.tenant_id = ?", asset.OwnerID, run.TenantID)
		query = admissionWorkspace(query, "res.workspace_id", run.WorkspaceID)
		return takeAdmission(query)
	default:
		return false, nil
	}
}

func admissionWorkspace(query *gorm.DB, column string, workspaceID *string) *gorm.DB {
	if workspaceID == nil {
		return query.Where(column + " IS NULL")
	}
	return query.Where(column+" = ?", *workspaceID)
}

func takeAdmission(query *gorm.DB) (bool, error) {
	var row struct{ ID persistenceid.UUID }
	err := query.Clauses(clause.Locking{Strength: "SHARE"}).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil, err
}

type imageGenerationAdmissionRow struct {
	TaskRunID  persistenceid.UUID `gorm:"column:task_run_id"`
	TargetType string
	TargetID   persistenceid.UUID
}

type assetAdmissionRow struct {
	ID        persistenceid.UUID
	OwnerType int16
	OwnerID   persistenceid.UUID
	DeletedAt soft_delete.DeletedAt `gorm:"softDelete:milli"`
}

func (assetAdmissionRow) TableName() string { return "assets" }
