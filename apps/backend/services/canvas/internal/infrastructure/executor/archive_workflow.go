package executor

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
	"gorm.io/gorm"
)

type archiveWorkflowRow struct {
	TaskRunID       string `gorm:"primaryKey;size:36"`
	ExecutorTaskID  string `gorm:"size:32;not null"`
	CancelRequested bool   `gorm:"not null"`
	Settled         bool   `gorm:"not null;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (archiveWorkflowRow) TableName() string { return "canvas_archive_workflows" }

type ArchiveWorkflowStore struct {
	db      *gorm.DB
	client  *Client
	service *applicationcanvasarchive.Service
}

func NewArchiveWorkflowStore(db *gorm.DB, client *Client) *ArchiveWorkflowStore {
	return &ArchiveWorkflowStore{db: db, client: client}
}

func (store *ArchiveWorkflowStore) Bind(service *applicationcanvasarchive.Service) {
	store.service = service
}

func (store *ArchiveWorkflowStore) CreateAsyncDispatch(ctx context.Context, dispatch domaintask.AsyncDispatch) error {
	return persistencetransaction.DB(ctx, store.db).Create(&archiveWorkflowRow{TaskRunID: dispatch.TaskRunID}).Error
}

func (store *ArchiveWorkflowStore) DeleteAsyncDispatch(ctx context.Context, taskRunID string) error {
	return persistencetransaction.DB(ctx, store.db).Model(&archiveWorkflowRow{}).
		Where("task_run_id = ? AND settled = false", taskRunID).
		Update("cancel_requested", true).Error
}

func (store *ArchiveWorkflowStore) Run(ctx context.Context) {
	var running sync.Map
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		var rows []archiveWorkflowRow
		if err := store.db.WithContext(ctx).Where("settled = false").Order("created_at").Limit(32).Find(&rows).Error; err != nil {
			if ctx.Err() == nil {
				slog.Error("reconcile Canvas archive workflows", "error", err)
			}
		} else {
			for index := range rows {
				row := rows[index]
				if _, loaded := running.LoadOrStore(row.TaskRunID, struct{}{}); loaded {
					continue
				}
				go func() {
					defer running.Delete(row.TaskRunID)
					if err := store.reconcile(ctx, row); err != nil && ctx.Err() == nil {
						slog.Warn("Canvas archive workflow will reconnect", "task_run_id", row.TaskRunID, "error", err)
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

func (store *ArchiveWorkflowStore) reconcile(ctx context.Context, row archiveWorkflowRow) error {
	if store.client == nil || store.service == nil {
		return errors.New("Canvas archive workflow is not configured")
	}
	if row.CancelRequested {
		var err error
		if row.ExecutorTaskID == "" {
			_, err = store.client.CancelByOwner(ctx, row.TaskRunID, "canvas-archive")
		} else {
			_, err = store.client.Cancel(ctx, row.ExecutorTaskID, row.TaskRunID)
		}
		if err != nil {
			return err
		}
		return store.db.WithContext(ctx).Model(&archiveWorkflowRow{}).
			Where("task_run_id = ? AND cancel_requested = true", row.TaskRunID).
			Update("settled", true).Error
	}
	task, err := store.client.Start(ctx, row.TaskRunID, "canvas-archive", map[string]string{
		"taskRunId": compactTaskRunID(row.TaskRunID),
	})
	if err != nil {
		return err
	}
	if err = store.db.WithContext(ctx).Model(&archiveWorkflowRow{}).Where("task_run_id = ?", row.TaskRunID).
		Update("executor_task_id", task.ID).Error; err != nil {
		return err
	}
	if err = store.db.WithContext(ctx).Where("task_run_id = ?", row.TaskRunID).First(&row).Error; err != nil {
		return err
	}
	if row.CancelRequested {
		task, err = store.client.Cancel(ctx, task.ID, row.TaskRunID)
		if err != nil {
			return err
		}
	}
	if !Terminal(task.Status) {
		task, err = store.client.WatchWithCancellation(ctx, task.ID, row.TaskRunID, func(checkCtx context.Context) (bool, error) {
			var current archiveWorkflowRow
			err := store.db.WithContext(checkCtx).Select("cancel_requested").Where("task_run_id = ?", row.TaskRunID).First(&current).Error
			return current.CancelRequested, err
		})
		if err != nil {
			return err
		}
	}
	if task.Status == "failed" || task.Status == "cancelled" {
		if err = store.service.CommitFailure(ctx, row.TaskRunID); err != nil && !errors.Is(err, applicationcanvasarchive.ErrExecutionTerminal) {
			return err
		}
	}
	return store.db.WithContext(ctx).Model(&archiveWorkflowRow{}).Where("task_run_id = ?", row.TaskRunID).Update("settled", true).Error
}

func compactTaskRunID(value string) string {
	result := make([]byte, 0, len(value))
	for index := range len(value) {
		if value[index] != '-' {
			result = append(result, value[index])
		}
	}
	return string(result)
}
