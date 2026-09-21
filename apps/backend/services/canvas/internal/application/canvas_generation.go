package application

import (
	"context"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	video "github.com/example/monorepo/canvas/internal/server/application/videogeneration"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
)

func (s *Service) StartCanvasGeneration(ctx context.Context, actor Actor, canvasID string, input c.StartCanvasGeneration) (c.CanvasGenerationBatch, error) {
	if strings.TrimSpace(input.OperationID) == "" || len(input.OperationID) > 100 {
		return c.CanvasGenerationBatch{}, Invalid("operation id is required and must not exceed 100 characters")
	}
	if _, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, true); err != nil {
		return c.CanvasGenerationBatch{}, err
	}
	graph, err := s.Graph(ctx, actor, canvasID)
	if err != nil {
		return c.CanvasGenerationBatch{}, err
	}
	nodes := make([]domain.CanvasNode, 0, len(graph.Nodes))
	revisions := make(map[string]int64)
	for _, node := range graph.Nodes {
		if node.Type == int16(domain.NodeTypeVideoGeneration) {
			nodes = append(nodes, domain.CanvasNode{ID: node.ID})
			revisions[node.ID] = node.Revision
		}
	}
	results, err := video.StartCanvasNodes(ctx, nodes, func(ctx context.Context, nodeID string) (string, bool, error) {
		result, err := s.StartGeneration(ctx, actor, canvasID, nodeID, c.StartGeneration{OperationID: input.OperationID + ":" + nodeID, ExpectedRevision: revisions[nodeID]})
		return result.ID, err == nil, err
	})
	if err != nil {
		return c.CanvasGenerationBatch{}, err
	}
	if err = ctx.Err(); err != nil {
		return c.CanvasGenerationBatch{}, err
	}
	out := c.CanvasGenerationBatch{Started: []c.CanvasGenerationStart{}}
	for _, result := range results {
		if result.Err != nil || !result.Started {
			out.SkippedCount++
			continue
		}
		out.Started = append(out.Started, c.CanvasGenerationStart{NodeID: result.NodeID, TaskRunID: result.TaskRunID})
	}
	return out, nil
}

func (s *Service) CanvasGenerationStatus(ctx context.Context, actor Actor, canvasID string) (c.GenerationStateList, error) {
	if _, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, false); err != nil {
		return c.GenerationStateList{}, err
	}
	type generationStateRow struct {
		ID              string
		NodeID          string
		Status          string
		TaskType        int16
		CancelRequested bool
	}
	var rows []generationStateRow
	err := s.DB.WithContext(ctx).
		Table("canvas_generations AS g").
		Select("DISTINCT ON (g.node_id) g.id, g.node_id, g.status, g.cancel_requested, CASE WHEN asset_match.id IS NULL THEN 1 ELSE 2 END AS task_type").
		Joins("LEFT JOIN canvas_asset_match_runs AS asset_match ON asset_match.id = g.id").
		Where("g.canvas_id = ? AND g.tenant_id = ? AND g.workspace_id = ?", canvasID, actor.TenantID, actor.WorkspaceID).
		Order("g.node_id, g.created_at DESC, g.id DESC").
		Scan(&rows).Error
	result := c.GenerationStateList{Items: []c.GenerationState{}}
	for _, row := range rows {
		result.Items = append(result.Items, c.GenerationState{ID: row.ID, NodeID: row.NodeID, Status: row.Status, TaskType: row.TaskType, CancelRequested: row.CancelRequested})
	}
	return result, err
}
