package deletion

import (
	"context"
	"errors"
	"time"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	application "github.com/example/monorepo/canvas/internal/application/deletion"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
)

// HideByCanvasNodes retains every cancellation target before visibility changes;
// the current node slot alone cannot describe superseded in-flight generations.
func (r *Repository) HideByCanvasNodes(ctx context.Context, scope applicationcanvas.Scope, ids []string, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	q := r.db.Queries(ctx)
	nodes, err := q.DeletionNodes(ctx, sqlc.DeletionNodesParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, Ids: ids})
	if err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}
	nodeIDs := make([]string, 0, len(nodes))
	for _, node := range nodes {
		nodeIDs = append(nodeIDs, node.ID)
	}
	runs, err := q.DeletionNodeRuns(ctx, sqlc.DeletionNodeRunsParams{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, Ids: nodeIDs})
	if err != nil {
		return err
	}
	runsByNode := make(map[string][]sqlc.DeletionNodeRunsRow, len(nodes))
	for _, run := range runs {
		runsByNode[run.SubjectID] = append(runsByNode[run.SubjectID], run)
	}
	queue := application.NewQueue(r)
	for _, node := range nodes {
		for _, run := range runsByNode[node.ID] {
			nodeType := domaincanvas.NodeTypeVideoGeneration
			switch domaintask.RunType(run.RunType) {
			case domaintask.RunTypeCanvasNodeTextGeneration:
				nodeType = domaincanvas.NodeTypeTextGeneration
			case domaintask.RunTypeCanvasStoryboardGeneration:
				nodeType = domaincanvas.NodeTypeStoryboardDraft
			}
			payload := applicationcanvas.NodeCleanupPayload{Scope: scope, NodeID: node.ID, ProjectID: node.ProjectID, CanvasID: node.CanvasID, TaskRunID: run.ID, NodeType: nodeType, NodeRevision: node.Revision, DeletedAt: now}
			payload.Scope.CallerID = run.CreatedBy
			if err := queue.Enqueue(ctx, scope.TenantID, applicationcanvas.NodeCleanupJobKind, "run:"+run.ID, payload); err != nil {
				return err
			}
		}
	}
	return nil
}

// PrepareCanvasDeletion runs under the parent's deletion transaction. Hidden
// history cannot be scheduled, but cancellation facts remain independently readable.
func (r *Repository) PrepareCanvasDeletion(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string, now time.Time) error {
	if scope.TenantID == "" || projectID == "" || now.IsZero() {
		return errors.New("invalid canvas deletion scope")
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		q := r.db.Queries(ctx)
		ids, err := q.DeletionCanvases(ctx, sqlc.DeletionCanvasesParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ProjectID:   projectID,
			CanvasID:    canvasID,
		})
		if err != nil {
			return err
		}
		queue := application.NewQueue(r)
		for offset := 0; offset < len(ids); offset += 100 {
			batch := ids[offset:min(offset+100, len(ids))]
			archives, err := q.DeletionArchiveRuns(ctx, sqlc.DeletionArchiveRunsParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				Ids:         batch,
			})
			if err != nil {
				return err
			}
			storyboards, err := q.DeletionStoryboardRuns(ctx, sqlc.DeletionStoryboardRunsParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				Ids:         batch,
			})
			if err != nil {
				return err
			}
			for _, row := range storyboards {
				archives = append(archives, sqlc.DeletionArchiveRunsRow(row))
			}
			runIDs := make([]string, 0, len(archives))
			for _, run := range archives {
				// Cancellation uses the task creator's identity even if another member deletes the canvas.
				payload := applicationcanvas.CanvasTaskCleanupPayload{Scope: scope, ProjectID: projectID, CanvasID: run.CanvasID, TaskRunID: run.ID, RunType: domaintask.RunType(run.RunType)}
				payload.Scope.CallerID = run.CreatedBy
				if err := queue.Enqueue(ctx, scope.TenantID, applicationcanvas.CanvasTaskCleanupJobKind, run.ID, payload); err != nil {
					return err
				}
				runIDs = append(runIDs, run.ID)
			}
			if err := q.HideCanvasDeletionRuns(ctx, sqlc.HideCanvasDeletionRunsParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				Ids:         runIDs,
				Now:         now,
			}); err != nil {
				return err
			}
			if err := q.ExpireCanvasDeletionArchives(ctx, sqlc.ExpireCanvasDeletionArchivesParams{
				ProjectID:   projectID,
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				Ids:         batch,
				Now:         &now,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ExpireDeletedArchive(ctx context.Context, taskRunID string, now time.Time) error {
	if taskRunID == "" {
		return errors.New("invalid archive cleanup target")
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		return r.db.Queries(ctx).ExpireDeletedTaskArchive(ctx, sqlc.ExpireDeletedTaskArchiveParams{ID: taskRunID, Now: &now})
	})
}
