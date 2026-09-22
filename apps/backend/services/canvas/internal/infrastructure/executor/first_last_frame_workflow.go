package executor

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	applicationfirstlastframe "github.com/example/monorepo/canvas/internal/application/firstlastframe"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"gorm.io/gorm"
)

const firstLastFrameTaskType = "canvas-video-frames"

type asyncDispatchDeleter interface {
	DeleteAsyncDispatch(context.Context, string) error
}

type frameFailureCommitter interface {
	CommitFailure(context.Context, string) error
}

type firstLastFrameDispatchRow struct {
	TaskRunID string
}

func (firstLastFrameDispatchRow) TableName() string { return "async_dispatches" }

type FirstLastFrameWorkflowStore struct {
	db         *gorm.DB
	client     *Client
	frames     frameFailureCommitter
	dispatches asyncDispatchDeleter
}

func NewFirstLastFrameWorkflowStore(
	db *gorm.DB,
	client *Client,
	frames frameFailureCommitter,
	dispatches asyncDispatchDeleter,
) *FirstLastFrameWorkflowStore {
	return &FirstLastFrameWorkflowStore{db: db, client: client, frames: frames, dispatches: dispatches}
}

func (store *FirstLastFrameWorkflowStore) Run(ctx context.Context) {
	var running sync.Map
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		var rows []firstLastFrameDispatchRow
		err := store.db.WithContext(ctx).
			Where("run_type = ?", domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction).
			Order("created_at").Limit(32).Find(&rows).Error
		if err != nil {
			if ctx.Err() == nil {
				slog.Error("reconcile Canvas first/last-frame workflows", "error", err)
			}
		} else {
			for index := range rows {
				row := rows[index]
				if _, loaded := running.LoadOrStore(row.TaskRunID, struct{}{}); loaded {
					continue
				}
				go func() {
					defer running.Delete(row.TaskRunID)
					if reconcileErr := store.reconcile(ctx, row.TaskRunID); reconcileErr != nil && ctx.Err() == nil {
						slog.Warn("Canvas first/last-frame workflow will reconnect", "task_run_id", row.TaskRunID, "error", reconcileErr)
					}
				}()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (store *FirstLastFrameWorkflowStore) reconcile(ctx context.Context, taskRunID string) error {
	if store.client == nil || store.frames == nil || store.dispatches == nil {
		return errors.New("Canvas first/last-frame workflow is not configured")
	}
	task, err := store.client.Start(ctx, taskRunID, firstLastFrameTaskType, map[string]string{
		"taskRunId": taskRunID,
	})
	if err != nil {
		return err
	}
	if !Terminal(task.Status) {
		task, err = store.client.Watch(ctx, task.ID, taskRunID, nil)
		if err != nil {
			return err
		}
	}
	if task.Status == "failed" || task.Status == "cancelled" {
		if err = store.frames.CommitFailure(ctx, taskRunID); err != nil &&
			!errors.Is(err, applicationfirstlastframe.ErrExecutionTerminal) {
			return err
		}
	}
	return store.dispatches.DeleteAsyncDispatch(ctx, taskRunID)
}
