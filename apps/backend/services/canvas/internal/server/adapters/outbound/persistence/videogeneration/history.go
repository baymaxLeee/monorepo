package videogeneration

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	app "github.com/example/monorepo/canvas/internal/server/application/videogeneration"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	domainvideo "github.com/example/monorepo/canvas/internal/server/domain/videogeneration"
)

func (r *Repository) UpdateGeneration(ctx context.Context, taskRunID string, update app.GenerationUpdate) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.ErrNotFound
	}
	updates := map[string]any{
		"status":        update.Status,
		"error_message": update.ErrorMessage,
		"completed_at":  update.CompletedAt,
		"updated_at":    update.UpdatedAt,
	}
	if update.AssetID != "" {
		assetID, parseErr := persistenceid.Parse(update.AssetID)
		if parseErr != nil {
			return parseErr
		}
		updates["asset_id"] = assetID
	}
	result := r.dbFor(ctx).Model(&canvasnodeVideoGenerationRow{}).Where("task_run_id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return r.ensureCanvasNodeVideoGenerationExists(ctx, id)
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
	var rows []canvasnodeVideoGenerationRow
	query := scopeQuery(r.dbFor(ctx), scope).Where(
		"project_id = ? AND canvas_id = ? AND node_id = ?",
		project,
		canvas,
		canvasnode,
	).Where("hidden_at IS NULL")
	if err = query.Order("created_at DESC").Order("task_run_id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	items := make([]domainvideo.Generation, 0, len(rows))
	for index := range rows {
		items = append(items, fromCanvasNodeVideoGenerationRow(rows[index]))
	}
	return items, nil
}

func (r *Repository) SelectGeneration(
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
	var row canvasnodeVideoGenerationRow
	query := scopeQuery(r.dbFor(ctx), scope).Where("hidden_at IS NULL")
	if err = query.Where(
		"task_run_id = ? AND project_id = ? AND canvas_id = ? AND node_id = ?",
		history,
		project,
		canvas,
		canvasnode,
	).First(&row).Error; err != nil {
		return domainvideo.Generation{}, readHistoryErr(err)
	}
	if row.Status != string(domaintask.StatusSucceeded) || row.AssetID == nil {
		return domainvideo.Generation{}, app.ErrHistoryNotSelectable
	}
	db := r.dbFor(ctx)
	update := scopeQuery(db.Model(&canvasCanvasNodeRow{}), scope).Where(
		"id = ? AND project_id = ? AND canvas_id = ?",
		canvasnode,
		project,
		canvas,
	).Updates(map[string]any{
		"resource_id":        nil,
		"resource_asset_id":  nil,
		"selected_output_id": row.TaskRunID,
		"selected_asset_id":  row.AssetID,
		"updated_by":         updatedBy,
		"updated_at":         updatedAt,
	})
	if update.Error != nil {
		return domainvideo.Generation{}, update.Error
	}
	if update.RowsAffected == 0 {
		var count int64
		if err = scopeQuery(r.dbFor(ctx).Model(&canvasCanvasNodeRow{}), scope).Where(
			"id = ? AND project_id = ? AND canvas_id = ?", canvasnode, project, canvas,
		).Count(&count).Error; err != nil {
			return domainvideo.Generation{}, err
		}
		if count == 0 {
			return domainvideo.Generation{}, app.ErrNotFound
		}
	}
	return fromCanvasNodeVideoGenerationRow(row), nil
}

func readHistoryErr(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app.ErrNotFound
	}
	return err
}
