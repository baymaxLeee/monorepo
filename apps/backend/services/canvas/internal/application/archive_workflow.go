package application

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	archiveRepo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/canvasarchive"
	txctx "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	task "github.com/example/monorepo/canvas/internal/server/domain/task"
	"gorm.io/gorm"
)

type workflowTask struct {
	TaskRunID       string `gorm:"primaryKey"`
	ExecutorTaskID  string
	CancelRequested bool
	Settled         bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (workflowTask) TableName() string { return "canvas_workflow_tasks" }

type archiveDispatch struct{ db *gorm.DB }

func (d archiveDispatch) CreateAsyncDispatch(ctx context.Context, v task.AsyncDispatch) error {
	return txctx.DB(ctx, d.db).Create(&workflowTask{TaskRunID: v.TaskRunID}).Error
}
func (d archiveDispatch) DeleteAsyncDispatch(ctx context.Context, id string) error {
	return txctx.DB(ctx, d.db).Model(&workflowTask{}).Where("task_run_id = ?", id).Update("cancel_requested", true).Error
}

func (s *Service) RunArchives(ctx context.Context) {
	var running sync.Map
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		var rows []workflowTask
		if err := s.DB.WithContext(ctx).Where("settled = false").Find(&rows).Error; err != nil {
			if ctx.Err() == nil {
				slog.Error("canvas workflow reconciliation failed", "error", err)
			}
		} else {
			for _, row := range rows {
				row.TaskRunID = strings.ReplaceAll(row.TaskRunID, "-", "")
				if _, loaded := running.LoadOrStore(row.TaskRunID, true); loaded {
					continue
				}
				go func(row workflowTask) {
					defer running.Delete(row.TaskRunID)
					if err := s.runArchive(ctx, row); err != nil && ctx.Err() == nil {
						slog.Warn("canvas workflow will reconnect", "task_run_id", row.TaskRunID, "error", err)
					}
				}(row)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Service) runArchive(ctx context.Context, row workflowTask) error {
	var input = map[string]string{"taskRunId": row.TaskRunID}
	t, err := s.Executor.Start(ctx, row.TaskRunID, "canvas-archive", input)
	if err != nil {
		return err
	}
	if err = s.DB.WithContext(ctx).Model(&workflowTask{}).Where("task_run_id = ?", row.TaskRunID).Update("executor_task_id", t.ID).Error; err != nil {
		return err
	}
	// Re-read persisted intent after starting: cancellation can race with dispatch.
	if err = s.DB.WithContext(ctx).First(&row, "task_run_id = ?", row.TaskRunID).Error; err != nil {
		return err
	}
	row.TaskRunID = strings.ReplaceAll(row.TaskRunID, "-", "")
	if row.CancelRequested {
		t, err = s.Executor.Cancel(ctx, t.ID, row.TaskRunID)
		if err != nil {
			return err
		}
	}
	if !executor.Terminal(t.Status) {
		t, err = s.Executor.WatchWithCancellation(ctx, t.ID, row.TaskRunID, func(checkCtx context.Context) (bool, error) {
			var current workflowTask
			err := s.DB.WithContext(checkCtx).Select("cancel_requested").First(&current, "task_run_id = ?", row.TaskRunID).Error
			return current.CancelRequested, err
		})
		if err != nil {
			return err
		}
	}
	if t.Status == "failed" || t.Status == "cancelled" {
		item, e := archiveRepo.NewRepository(s.DB).GetByTaskRunID(ctx, row.TaskRunID)
		if e != nil {
			return e
		}
		actor := Actor{TenantID: item.TenantID, UserID: item.CreatedBy}
		if item.WorkspaceID != nil {
			actor.WorkspaceID = *item.WorkspaceID
		}
		if err = s.archives(actor).CommitFailure(ctx, row.TaskRunID); err != nil {
			return err
		}
	}
	return s.DB.WithContext(ctx).Model(&workflowTask{}).Where("task_run_id = ?", row.TaskRunID).Update("settled", true).Error
}
