package canvasstatistics

import (
	"context"

	"gorm.io/gorm"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationcanvasnode "github.com/example/monorepo/canvas/internal/server/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/server/domain/canvas"
)

type Rebuilder struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Rebuilder {
	return &Rebuilder{db: db}
}

func (p *Rebuilder) Rebuild(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID string) error {
	projectUUID, err := persistenceid.Parse(projectID)
	if err != nil {
		return err
	}
	canvasUUID, err := persistenceid.Parse(canvasID)
	if err != nil {
		return err
	}
	return p.rebuild(transaction.DB(ctx, p.db), scope, projectUUID, canvasUUID)
}

func (p *Rebuilder) rebuild(db *gorm.DB, scope applicationcanvasnode.Scope, projectID, canvasID persistenceid.UUID) error {
	var statistics struct {
		CanvasNodeCount             int32
		SelectedVideoDurationMillis int64
	}
	query := db.Table("canvas_nodes").
		Joins(
			"LEFT JOIN canvas_node_generations ON canvas_node_generations.task_run_id = canvas_nodes.selected_output_id",
		).
		Select(
			"COUNT(canvas_nodes.id) AS canvas_node_count, "+
				"COALESCE(SUM(CASE "+
				"WHEN canvas_nodes.selected_output_id IS NOT NULL "+
				"AND COALESCE(canvas_node_generations.output_duration_seconds, canvas_node_generations.duration_seconds) > 0 "+
				"THEN COALESCE(canvas_node_generations.output_duration_seconds, canvas_node_generations.duration_seconds) * 1000 "+
				"WHEN canvas_nodes.selected_asset_id IS NOT NULL "+
				"AND CAST(canvas_nodes.node_data ->> '$.payload.generation_config.duration_seconds' AS SIGNED) > 0 "+
				"THEN CAST(canvas_nodes.node_data ->> '$.payload.generation_config.duration_seconds' AS SIGNED) * 1000 "+
				"ELSE 0 END), 0) AS selected_video_duration_millis",
		).
		Where(
			"canvas_nodes.tenant_id = ? AND canvas_nodes.project_id = ? AND canvas_nodes.canvas_id = ? AND canvas_nodes.type = ? AND canvas_nodes.deleted_at = 0",
			scope.TenantID,
			projectID,
			canvasID,
			domaincanvas.NodeTypeVideoGeneration,
		)
	if scope.WorkspaceID == nil {
		query = query.Where("canvas_nodes.workspace_id IS NULL")
	} else {
		query = query.Where("canvas_nodes.workspace_id = ?", *scope.WorkspaceID)
	}
	if err := query.Scan(&statistics).Error; err != nil {
		return err
	}
	query = db.Table("canvases").Where(
		"id = ? AND tenant_id = ? AND project_id = ? AND deleted_at = 0",
		canvasID, scope.TenantID, projectID,
	)
	if scope.WorkspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *scope.WorkspaceID)
	}
	return query.Updates(map[string]any{
		"canvas_node_count":              statistics.CanvasNodeCount,
		"selected_video_duration_millis": statistics.SelectedVideoDurationMillis,
	}).Error
}
