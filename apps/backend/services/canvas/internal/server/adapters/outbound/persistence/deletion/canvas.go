package deletion

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	transaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationcanvas "github.com/example/monorepo/canvas/internal/server/application/canvas"
	application "github.com/example/monorepo/canvas/internal/server/application/deletion"
	domaincanvas "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
)

// HideByCanvasNodes retains every cancellation target before visibility changes;
// the current node slot alone cannot describe superseded in-flight generations.
func (r *Repository) HideByCanvasNodes(ctx context.Context, scope applicationcanvas.Scope, ids []string, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	db := transaction.DB(ctx, r.db)
	var nodes []struct {
		ID, ProjectID, CanvasID string
		Revision                int64
	}
	if err := deletionScope(db.Table("canvas_nodes"), scope).Where("id IN ?", ids).Select("id, project_id, canvas_id, revision").Find(&nodes).Error; err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}
	nodeIDs := make([]string, 0, len(nodes))
	for _, node := range nodes {
		nodeIDs = append(nodeIDs, node.ID)
	}
	type nodeRun struct {
		ID, SubjectID, CreatedBy string
		RunType                  domaintask.RunType
	}
	var runs []nodeRun
	if err := deletionScope(db.Table("task_runs"), scope).
		Where("subject_type = ? AND subject_id IN ? AND run_type IN ?", domaintask.SubjectTypeCanvasNode, nodeIDs, []domaintask.RunType{domaintask.RunTypeCanvasNodeVideoGeneration, domaintask.RunTypeCanvasNodeTextGeneration}).
		Select("id, subject_id, created_by, run_type").Find(&runs).Error; err != nil {
		return err
	}
	runsByNode := make(map[string][]nodeRun, len(nodes))
	for _, run := range runs {
		runsByNode[run.SubjectID] = append(runsByNode[run.SubjectID], run)
	}
	queue := application.NewQueue(r)
	for _, node := range nodes {
		for _, run := range runsByNode[node.ID] {
			nodeType := domaincanvas.NodeTypeVideoGeneration
			if run.RunType == domaintask.RunTypeCanvasNodeTextGeneration {
				nodeType = domaincanvas.NodeTypeTextGeneration
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
	db := transaction.DB(ctx, r.db)
	canvases := deletionScope(db.Table("canvases"), scope).Where("project_id = ?", projectID)
	if canvasID != "" {
		canvases = canvases.Where("id = ?", canvasID)
	}
	var ids []string
	if err := canvases.Pluck("id", &ids).Error; err != nil {
		return err
	}
	queue := application.NewQueue(r)
	for offset := 0; offset < len(ids); offset += 100 {
		batch := ids[offset:min(offset+100, len(ids))]
		query := deletionScope(db.Table("task_runs"), scope).Where("subject_type = ? AND subject_id IN ? AND run_type IN ?", domaintask.SubjectTypeCanvas, batch, []domaintask.RunType{domaintask.RunTypeCanvasStoryboardGeneration, domaintask.RunTypeCanvasVideoArchiveExport})
		var runs []struct {
			ID, SubjectID, CreatedBy string
			RunType                  domaintask.RunType
		}
		if err := query.Session(&gorm.Session{}).Select("id, subject_id, created_by, run_type").Find(&runs).Error; err != nil {
			return err
		}
		for _, run := range runs {
			payload := applicationcanvas.CanvasTaskCleanupPayload{Scope: scope, ProjectID: projectID, CanvasID: run.SubjectID, TaskRunID: run.ID, RunType: run.RunType}
			// Storyboard drafts belong to their creator, not the deleting member.
			payload.Scope.CallerID = run.CreatedBy
			if err := queue.Enqueue(ctx, scope.TenantID, applicationcanvas.CanvasTaskCleanupJobKind, run.ID, payload); err != nil {
				return err
			}
		}
		if err := query.Where("hidden_at IS NULL").Updates(map[string]any{"hidden_at": now, "state_version": gorm.Expr("state_version + 1"), "updated_at": now}).Error; err != nil {
			return err
		}
		// Existing output associations already have a durable cleanup state. Reuse
		// that owner rather than creating a second storage deletion protocol.
		if err := deletionScope(db.Table("canvas_video_archive_exports"), scope).Where("project_id = ? AND canvas_id IN ? AND cleanup_status = ?", projectID, batch, "PENDING").Updates(map[string]any{"cleanup_next_at": now, "retention_guaranteed_until": now, "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}

func deletionScope(db *gorm.DB, scope applicationcanvas.Scope) *gorm.DB {
	db = db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return db.Where("workspace_id IS NULL")
	}
	return db.Where("workspace_id = ?", *scope.WorkspaceID)
}

func (r *Repository) ExpireDeletedArchive(ctx context.Context, taskRunID string, now time.Time) error {
	if taskRunID == "" {
		return errors.New("invalid archive cleanup target")
	}
	return transaction.DB(ctx, r.db).Table("canvas_video_archive_exports").Where("task_run_id = ? AND cleanup_status = ?", taskRunID, "PENDING").Updates(map[string]any{"cleanup_next_at": now, "retention_guaranteed_until": now, "updated_at": now}).Error
}
