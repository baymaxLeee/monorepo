package task

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
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
	return admitted(r.db.Queries(ctx).LockActiveCanvasNode(ctx, sqlc.LockActiveCanvasNodeParams{
		ID:          id.String(),
		TenantID:    run.TenantID,
		WorkspaceID: run.WorkspaceID,
	}))
}

func (r *Repository) activeCanvas(ctx context.Context, run domaintask.TaskRun, canvasID string) (bool, error) {
	id, err := persistenceid.Parse(canvasID)
	if err != nil {
		return false, nil
	}
	return admitted(r.db.Queries(ctx).LockActiveTaskCanvas(ctx, sqlc.LockActiveTaskCanvasParams{
		ID:          id.String(),
		TenantID:    run.TenantID,
		WorkspaceID: run.WorkspaceID,
	}))
}

func (r *Repository) activeImageGenerationTarget(ctx context.Context, run domaintask.TaskRun) (bool, error) {
	id, err := persistenceid.Parse(run.ID)
	if err != nil {
		return false, nil
	}
	target, err := r.db.Queries(ctx).ReadTaskTarget(ctx, sqlc.ReadTaskTargetParams{
		ID:          id.String(),
		TenantID:    run.TenantID,
		WorkspaceID: run.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if target.TargetID != run.SubjectID {
		return false, nil
	}
	switch domainimagegeneration.TargetType(target.TargetType) {
	case domainimagegeneration.TargetCanvasNode:
		return r.activeCanvasNode(ctx, run, target.TargetID)
	case domainimagegeneration.TargetResourceAsset:
		return admitted(r.db.Queries(ctx).LockActiveTaskDraft(ctx, sqlc.LockActiveTaskDraftParams{
			ID:          &target.TargetID,
			TenantID:    run.TenantID,
			WorkspaceID: run.WorkspaceID,
		}))
	default:
		return false, nil
	}
}

func (r *Repository) activeAssetOwner(ctx context.Context, run domaintask.TaskRun) (bool, error) {
	id, err := persistenceid.Parse(run.SubjectID)
	if err != nil {
		return false, nil
	}
	owner, err := r.db.Queries(ctx).ReadTaskAssetOwner(ctx, sqlc.ReadTaskAssetOwnerParams{
		ID:          id.String(),
		TenantID:    run.TenantID,
		WorkspaceID: run.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	switch domainasset.OwnerType(owner.OwnerType) {
	case domainasset.OwnerOfficial:
		return true, nil
	case domainasset.OwnerProject:
		return admitted(r.db.Queries(ctx).LockActiveTaskProject(ctx, sqlc.LockActiveTaskProjectParams{
			ID:          owner.OwnerID,
			TenantID:    run.TenantID,
			WorkspaceID: run.WorkspaceID,
		}))
	case domainasset.OwnerResource:
		return admitted(r.db.Queries(ctx).LockActiveTaskResource(ctx, sqlc.LockActiveTaskResourceParams{
			ID:          owner.OwnerID,
			TenantID:    run.TenantID,
			WorkspaceID: run.WorkspaceID,
		}))
	default:
		return false, nil
	}
}

func admitted(_ string, err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
