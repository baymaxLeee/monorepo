package application

import (
	"context"
	"encoding/json"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"log/slog"
	"sync"
	"time"
)

func (s *Service) RunStoryboardDrafts(ctx context.Context) {
	var running sync.Map
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		var rows []p.StoryboardDraft
		if err := s.DB.WithContext(ctx).Where("status IN ?", []string{"queued", "running"}).Find(&rows).Error; err != nil {
			if ctx.Err() == nil {
				slog.Error("storyboard reconciliation failed", "error", err)
			}
		} else {
			for _, row := range rows {
				if _, loaded := running.LoadOrStore(row.ID, true); loaded {
					continue
				}
				go func(row p.StoryboardDraft) {
					defer running.Delete(row.ID)
					if err := s.runStoryboard(ctx, row); err != nil && ctx.Err() == nil {
						slog.Warn("storyboard will reconnect", "id", row.ID, "error", err)
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
func (s *Service) runStoryboard(ctx context.Context, row p.StoryboardDraft) error {
	if row.CancelRequested && row.TaskID == "" {
		task, err := s.Executor.CancelByOwner(ctx, row.ID, "canvas-storyboard")
		if err != nil {
			return err
		}
		return s.DB.WithContext(ctx).Model(&row).Where("task_id = ''").Updates(map[string]any{"status": "discarded", "task_id": task.ID}).Error
	}
	var input c.StoryboardDraftInput
	if err := json.Unmarshal([]byte(row.Input), &input); err != nil {
		return err
	}
	payload := map[string]any{"tenantId": row.TenantID, "workspaceId": row.WorkspaceID, "providerId": input.ProviderID, "plot": input.Plot, "durationMin": input.DurationMin, "durationMax": input.DurationMax, "totalDurationMin": input.TotalDurationMin, "totalDurationMax": input.TotalDurationMax}
	task, err := s.Executor.Start(ctx, row.ID, "canvas-storyboard", payload)
	if err != nil {
		return err
	}
	if err = s.DB.WithContext(ctx).Model(&row).Where("status IN ?", []string{"queued", "running"}).Updates(map[string]any{"task_id": task.ID, "status": "running"}).Error; err != nil {
		return err
	}
	if err = s.DB.WithContext(ctx).First(&row, "id = ?", row.ID).Error; err != nil {
		return err
	}
	if row.CancelRequested {
		task, err = s.Executor.Cancel(ctx, task.ID, row.ID)
		if err != nil {
			return err
		}
	}
	if !executor.Terminal(task.Status) {
		task, err = s.Executor.WatchWithCancellation(ctx, task.ID, row.ID, func(checkCtx context.Context) (bool, error) {
			var current p.StoryboardDraft
			err := s.DB.WithContext(checkCtx).Select("cancel_requested").First(&current, "id = ?", row.ID).Error
			return current.CancelRequested, err
		})
		if err != nil {
			return err
		}
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", row.ID).Error; err != nil {
			return err
		}
		if row.Status != "queued" && row.Status != "running" {
			return nil
		}
		row.Status = task.Status
		if row.CancelRequested {
			row.Status = "discarded"
		}
		if row.Status == "failed" {
			row.Error = "分镜生成失败，请检查模型配置后重试"
		}
		if row.Status == "completed" {
			var shots []c.StoryboardShot
			if err := json.Unmarshal([]byte(task.Result.Text), &shots); err != nil || len(shots) == 0 {
				row.Status = "failed"
				row.Error = "模型未返回有效分镜"
			} else {
				for i := range shots {
					shots[i].ID = newID()
				}
				raw, err := json.Marshal(shots)
				if err != nil {
					return err
				}
				row.Shots = string(raw)
			}
		}
		return tx.Save(&row).Error
	})
}
