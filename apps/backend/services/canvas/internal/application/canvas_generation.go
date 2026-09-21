package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	video "github.com/example/monorepo/canvas/internal/server/application/videogeneration"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	"strings"
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
	var rows []p.Generation
	err := s.DB.WithContext(ctx).Select("DISTINCT ON (node_id) id, node_id, status, cancel_requested").Where("canvas_id = ? AND tenant_id = ? AND workspace_id = ? AND id NOT IN (SELECT id FROM canvas_asset_match_runs)", canvasID, actor.TenantID, actor.WorkspaceID).Order("node_id, created_at DESC, id DESC").Find(&rows).Error
	result := c.GenerationStateList{Items: []c.GenerationState{}}
	for _, row := range rows {
		result.Items = append(result.Items, c.GenerationState{ID: row.ID, NodeID: row.NodeID, Status: row.Status, CancelRequested: row.CancelRequested})
	}
	return result, err
}
