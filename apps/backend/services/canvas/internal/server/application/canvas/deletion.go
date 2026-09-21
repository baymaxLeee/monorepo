package canvas

import (
	"context"
	"errors"
	"fmt"
	"time"

	applicationcoverimage "github.com/example/monorepo/canvas/internal/server/application/coverimage"
	applicationdeletion "github.com/example/monorepo/canvas/internal/server/application/deletion"
	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
)

const NodeCleanupJobKind = "canvas.node.cleanup.v1"

const CanvasTaskCleanupJobKind = "canvas.task.cleanup.v1"

const CanvasCleanupJobKind = "canvas.cleanup.v1"

type CanvasCleanupPayload struct {
	Scope               Scope
	ProjectID, CanvasID string
	CanvasRevision      int64
	DeletedAt           time.Time
}

type DeletionTarget struct {
	CanvasID string
	Revision int64
	Cover    *applicationcoverimage.Registration
}

type CanvasTaskCleanupPayload struct {
	Scope                          Scope
	ProjectID, CanvasID, TaskRunID string
	RunType                        domaintask.RunType
}

type CanvasDeletionPreparer interface {
	PrepareCanvasDeletion(context.Context, Scope, string, string, time.Time) error
}

func WithCanvasDeletionPreparer(preparer CanvasDeletionPreparer) Option {
	return func(s *Service) { s.deletionPreparer = preparer }
}

func WithCanvasDeletionQueue(queue *applicationdeletion.Queue) Option {
	return func(s *Service) { s.deletion = queue }
}

func (s *Service) enqueueCanvasCleanup(
	ctx context.Context,
	scope Scope,
	projectID, canvasID string,
	revision int64,
	deletedAt time.Time,
) error {
	key := fmt.Sprintf("%s:%d:%d", canvasID, revision, deletedAt.UnixMilli())
	return s.deletion.Enqueue(ctx, scope.TenantID, CanvasCleanupJobKind, key, CanvasCleanupPayload{
		Scope: scope, ProjectID: projectID, CanvasID: canvasID,
		CanvasRevision: revision, DeletedAt: deletedAt,
	})
}

// CleanupDeletedCanvas traverses descendants only after the parent Canvas and
// its durable cleanup fact have committed. Every step must converge when a
// previous attempt committed only a subset of the independent cleanup effects.
func (s *Service) CleanupDeletedCanvas(ctx context.Context, input CanvasCleanupPayload) error {
	if !isValidScope(input.Scope) || input.ProjectID == "" || input.CanvasID == "" ||
		input.CanvasRevision < 1 || input.DeletedAt.IsZero() {
		return errors.New("invalid deleted canvas target")
	}
	if s.canvas_nodes == nil {
		return errors.New("canvas node cleanup is unavailable")
	}
	return s.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		matches, err := s.repository.DeletionMatches(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, input.CanvasRevision, input.DeletedAt,
		)
		if err != nil || !matches {
			return err
		}
		if s.deletionPreparer != nil {
			if err = s.deletionPreparer.PrepareCanvasDeletion(
				txCtx, input.Scope, input.ProjectID, input.CanvasID, input.DeletedAt,
			); err != nil {
				return err
			}
		}
		deleted, _, err := s.canvas_nodes.repository.DeleteByCanvas(
			txCtx, input.Scope, input.ProjectID, input.CanvasID, input.DeletedAt,
		)
		if err != nil {
			return err
		}
		for _, node := range deleted {
			if err = s.canvas_nodes.releaseCanvasNodeReferences(txCtx, input.Scope, node); err != nil {
				return err
			}
		}
		return s.canvas_nodes.prepareDeletedNodes(txCtx, input.Scope, deleted, input.DeletedAt)
	})
}

type NodeCleanupPayload struct {
	Scope                                  Scope
	NodeID, ProjectID, CanvasID, TaskRunID string
	NodeType                               domain.NodeType
	NodeRevision                           int64
	DeletedAt                              time.Time
}

func WithCanvasNodeDeletionQueue(queue *applicationdeletion.Queue) CanvasNodeOption {
	return func(s *CanvasNodeService) { s.deletion = queue }
}

func (s *CanvasNodeService) prepareDeletedNodes(ctx context.Context, scope Scope, deleted []domain.CanvasNode, now time.Time) error {
	ids := make([]string, 0, len(deleted))
	for _, node := range deleted {
		ids = append(ids, node.ID)
		// A restored node retains its ID. Deduplicating by that ID alone would
		// suppress cancellation for every subsequent delete/redo incarnation.
		key := fmt.Sprintf("%s:%d:%d", node.ID, node.Revision, now.UnixMilli())
		if err := s.deletion.Enqueue(ctx, scope.TenantID, NodeCleanupJobKind, key, NodeCleanupPayload{
			Scope: scope, NodeID: node.ID, ProjectID: node.ProjectID, CanvasID: node.CanvasID,
			TaskRunID: node.ActiveTaskRunID, NodeType: node.Type, NodeRevision: node.Revision, DeletedAt: now,
		}); err != nil {
			return err
		}
	}
	if len(ids) == 0 {
		return nil
	}
	// Visibility and retaining references are database effects and must roll
	// back together with node deletion. Provider cancellation runs from the job.
	if err := s.visibility.HideByCanvasNodes(ctx, scope, ids, now); err != nil {
		return err
	}
	if s.assetMatchTasks != nil {
		return s.assetMatchTasks.runs.HideTaskRunsBySubjects(ctx, applicationtask.Scope{TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID}, domaintask.RunTypeCanvasNodeAssetsMatch, domaintask.SubjectTypeCanvasNode, ids, now)
	}
	return nil
}

func (s *CanvasNodeService) CleanupDeletedNode(ctx context.Context, input NodeCleanupPayload) error {
	if input.Scope.TenantID == "" || input.NodeID == "" || input.DeletedAt.IsZero() {
		return errors.New("invalid deleted node target")
	}
	if input.TaskRunID == "" {
		return nil
	}
	matches, err := s.repository.DeletionMatches(
		ctx, input.Scope, input.ProjectID, input.CanvasID, input.NodeID, input.NodeRevision, input.DeletedAt,
	)
	if err != nil || !matches {
		return err
	}
	if s.assetMatchTasks != nil {
		run, readErr := s.assetMatchTasks.runs.GetTaskRun(ctx, input.TaskRunID)
		if readErr != nil && !errors.Is(readErr, applicationtask.ErrNotFound) {
			return readErr
		}
		if readErr == nil && run.RunType == domaintask.RunTypeCanvasNodeAssetsMatch {
			if run.TenantID != input.Scope.TenantID || run.SubjectID != input.NodeID || run.SubjectType != domaintask.SubjectTypeCanvasNode ||
				(run.WorkspaceID == nil) != (input.Scope.WorkspaceID == nil) ||
				(run.WorkspaceID != nil && input.Scope.WorkspaceID != nil && *run.WorkspaceID != *input.Scope.WorkspaceID) {
				return errors.New("asset matching cleanup scope mismatch")
			}
			return s.transactions.WithinTransaction(ctx, func(tx context.Context) error {
				if !run.Terminal() {
					now := s.clock.Now()
					ok, e := s.assetMatchTasks.runs.UpdateTaskRun(tx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &now}, now)
					if e != nil {
						return e
					}
					if !ok {
						return ErrRevisionConflict
					}
				}
				return s.assetMatchTasks.schedules.DeletePollSchedule(tx, run.ID)
			})
		}
	}
	if s.canceller == nil {
		return errors.New("node task canceller is unavailable")
	}
	return s.canceller.CancelActive(ctx, input.Scope, domain.CanvasNode{
		ID: input.NodeID, ProjectID: input.ProjectID, CanvasID: input.CanvasID,
		Type: input.NodeType, ActiveTaskRunID: input.TaskRunID,
	})
}
