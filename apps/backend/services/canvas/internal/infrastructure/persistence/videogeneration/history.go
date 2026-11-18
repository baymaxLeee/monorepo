package videogeneration

import (
	"context"
	"errors"
	"time"

	app "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) UpdateGeneration(ctx context.Context, taskRunID string, update app.GenerationUpdate) (err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error { return r.updateGenerationInTransaction(ctx, taskRunID, update) })
	return
}

func (r *Repository) updateGenerationInTransaction(ctx context.Context, taskRunID string, update app.GenerationUpdate) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.ErrNotFound
	}
	asset, err := nullableUUID(update.AssetID)
	if err != nil {
		return err
	}
	affected, err := r.store.Queries(ctx).VideoGenUpdate(ctx, sqlc.VideoGenUpdateParams{
		ID:           id.String(),
		Status:       string(update.Status),
		ErrorMessage: update.ErrorMessage,
		CompletedAt:  update.CompletedAt,
		UpdatedAt:    update.UpdatedAt,
		AssetID:      asset,
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		return app.ErrNotFound
	}
	return nil
}

func (r *Repository) ListGenerations(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID, canvasnodeID string,
) ([]domainvideo.Generation, error) {
	project, canvas, canvasnode, err := parseHistoryScopeIDs(projectID, canvasID, canvasnodeID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	rows, err := r.store.Queries(ctx).VideoGenList(ctx, sqlc.VideoGenListParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		NodeID:      canvasnode.String(),
	})
	if err != nil {
		return nil, err
	}
	items := make([]domainvideo.Generation, 0, len(rows))
	for index := range rows {
		item, err := fromCanvasNodeVideoGenerationRow(rows[index])
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) SelectGeneration(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID, canvasnodeID, historyID, updatedBy string,
	updatedAt time.Time,
) (generation domainvideo.Generation, err error) {
	err = r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		generation, err = r.selectGenerationInTransaction(ctx, scope, projectID, canvasID, canvasnodeID, historyID, updatedBy, updatedAt)
		return err
	})
	return
}

func (r *Repository) selectGenerationInTransaction(
	ctx context.Context,
	scope app.Scope,
	projectID, canvasID, canvasnodeID, historyID, updatedBy string,
	updatedAt time.Time,
) (domainvideo.Generation, error) {
	project, canvas, canvasnode, err := parseHistoryScopeIDs(projectID, canvasID, canvasnodeID)
	if err != nil {
		return domainvideo.Generation{}, app.ErrNotFound
	}
	history, err := persistenceid.Parse(historyID)
	if err != nil {
		return domainvideo.Generation{}, app.ErrNotFound
	}
	row, err := r.store.Queries(ctx).VideoGenHistory(ctx, sqlc.VideoGenHistoryParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		NodeID:      canvasnode.String(),
		ID:          history.String(),
	})
	if err != nil {
		return domainvideo.Generation{}, readHistoryErr(err)
	}
	if row.Status != string(domaintask.StatusSucceeded) || row.AssetID == nil {
		return domainvideo.Generation{}, app.ErrHistoryNotSelectable
	}
	affected, err := r.store.Queries(ctx).VideoGenSelect(ctx, sqlc.VideoGenSelectParams{
		RunID:       &row.TaskRunID,
		AssetID:     row.AssetID,
		UpdatedBy:   updatedBy,
		UpdatedAt:   updatedAt,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		NodeID:      canvasnode.String(),
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
	})
	if err != nil {
		return domainvideo.Generation{}, err
	}
	if affected == 0 {
		return domainvideo.Generation{}, app.ErrNotFound
	}
	return fromCanvasNodeVideoGenerationRow(row)
}

func readHistoryErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrNotFound
	}
	return err
}
