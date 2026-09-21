package application

import (
	"context"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"log/slog"
	"sync"
	"time"
)

func (s *Service) RunVideoFrames(ctx context.Context) {
	var active sync.Map
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		var rows []p.VideoFrames
		if err := s.DB.WithContext(ctx).Where("status IN ?", []string{"queued", "running"}).Find(&rows).Error; err != nil {
			if ctx.Err() == nil {
				slog.Error("frame reconciliation failed", "error", err)
			}
		} else {
			for _, row := range rows {
				if _, loaded := active.LoadOrStore(row.ID, true); loaded {
					continue
				}
				go func(row p.VideoFrames) {
					defer active.Delete(row.ID)
					if err := s.runVideoFrames(ctx, row); err != nil && ctx.Err() == nil {
						slog.Warn("frame task will reconnect", "id", row.ID, "error", err)
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
func (s *Service) runVideoFrames(ctx context.Context, row p.VideoFrames) error {
	if row.CancelRequested && row.TaskID == "" {
		task, err := s.Executor.CancelByOwner(ctx, row.ID, "canvas-video-frames")
		if err != nil {
			return err
		}
		return s.DB.WithContext(ctx).Model(&row).Where("task_id = '' AND status IN ?", []string{"queued", "running"}).Updates(map[string]any{"status": "cancelled", "task_id": task.ID}).Error
	}
	task, err := s.Executor.Start(ctx, row.ID, "canvas-video-frames", map[string]string{"taskRunId": row.ID})
	if err != nil {
		return err
	}
	if err = s.DB.WithContext(ctx).Model(&row).Where("status IN ?", []string{"queued", "running"}).Updates(map[string]any{"status": "running", "task_id": task.ID}).Error; err != nil {
		return err
	}
	if !executor.Terminal(task.Status) {
		task, err = s.Executor.WatchWithCancellation(ctx, task.ID, row.ID, func(checkCtx context.Context) (bool, error) {
			var current p.VideoFrames
			err := s.DB.WithContext(checkCtx).Select("cancel_requested").First(&current, "id = ?", row.ID).Error
			return current.CancelRequested, err
		})
		if err != nil {
			return err
		}
	}
	// Only the Go commit owns successful frame output; a missing commit is failure.
	status := "failed"
	if task.Status == "cancelled" {
		status = "cancelled"
	}
	return s.DB.WithContext(ctx).Model(&row).Where("status IN ?", []string{"queued", "running"}).Update("status", status).Error
}
