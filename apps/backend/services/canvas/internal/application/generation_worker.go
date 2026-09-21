package application

import (
	"context"
	"encoding/json"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"log/slog"
	"sync"
	"time"
)

// The database outbox survives restarts; Executor deduplicates dispatch by generation ID.
func (s *Service) RunGenerations(ctx context.Context) {
	var running sync.Map
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		var rows []p.Generation
		if err := s.DB.WithContext(ctx).Where("status IN ?", []string{"queued", "running"}).Find(&rows).Error; err != nil {
			if ctx.Err() == nil {
				slog.Error("generation reconciliation failed", "error", err)
			}
		} else {
			for _, row := range rows {
				if _, loaded := running.LoadOrStore(row.ID, true); loaded {
					continue
				}
				go func(row p.Generation) {
					defer running.Delete(row.ID)
					if err := s.runGeneration(ctx, row); err != nil && ctx.Err() == nil {
						slog.Warn("generation will reconnect", "generation_id", row.ID, "error", err)
					}
				}(row)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
func (s *Service) runGeneration(ctx context.Context, row p.Generation) error {
	requested, checkErr := s.generationCancellation(ctx, row.ID)
	if checkErr != nil {
		return checkErr
	}
	row.CancelRequested = requested
	if row.CancelRequested && row.TaskID == "" {
		task, err := s.Executor.CancelByOwner(ctx, row.ID, row.TaskType)
		if err != nil {
			return err
		}
		if err = s.DB.WithContext(ctx).Model(&p.Generation{}).Where("id = ?", row.ID).Update("task_id", task.ID).Error; err != nil {
			return err
		}
		row.TaskID = task.ID
	}
	var input any = executor.TextInput{TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, ProviderID: row.ProviderID, Prompt: row.Prompt}
	if row.TaskType == "canvas-image-generation" || row.TaskType == "canvas-video-generation" {
		input = json.RawMessage(row.InputPayload)
	}
	task, err := s.Executor.Start(ctx, row.ID, row.TaskType, input)
	if err != nil {
		return err
	}
	if err = s.DB.WithContext(ctx).Model(&p.Generation{}).Where("id = ? AND status IN ?", row.ID, []string{"queued", "running"}).Updates(map[string]any{"task_id": task.ID, "status": "running"}).Error; err != nil {
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
			return s.generationCancellation(checkCtx, row.ID)
		})
		if err != nil {
			return err
		}
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Match graph mutation's project -> board -> generation lock order.
		var board p.Board
		if err := tx.Unscoped().First(&board, "id = ?", row.CanvasID).Error; err != nil {
			return err
		}
		var project p.Project
		if err := tx.Unscoped().Clauses(clause.Locking{Strength: "SHARE"}).First(&project, "id = ?", board.ProjectID).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", row.CanvasID).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", row.ID).Error; err != nil {
			return err
		}
		if executor.Terminal(row.Status) {
			return nil
		}
		row.Status = task.Status
		if row.CancelRequested {
			row.Status = "cancelled"
		}
		if row.Status == "failed" {
			row.Error = "生成失败，请检查模型配置后重试"
		}
		if task.Status == "completed" {
			row.OutputText = task.Result.Text
		}
		if row.Status == "completed" && !board.DeletedAt.Valid && !project.DeletedAt.Valid {
			var node p.Node
			err := tx.Where("id = ? AND canvas_id = ?", row.NodeID, row.CanvasID).First(&node).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == nil && task.Result.ObjectKey != "" {
				asset := p.Asset{ID: newID(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, ProjectID: board.ProjectID, ObjectKey: task.Result.ObjectKey, MimeType: task.Result.MimeType}
				if err = tx.Create(&asset).Error; err != nil {
					return err
				}
				if err = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "CANVAS_GENERATION_OUTPUT", OwnerKey: row.ID}).Error; err != nil {
					return err
				}
				row.OutputAssetID = asset.ID
				if row.TaskType == "canvas-video-generation" {
					if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&p.VideoFrames{ID: newID(), GenerationID: row.ID, Status: "queued"}).Error; err != nil {
						return err
					}
				}
			}
			if err == nil && node.Revision == row.NodeRevision {
				node.Text = row.OutputText
				node.AssetID = row.OutputAssetID
				node.Revision++
				if err = tx.Save(&node).Error; err != nil {
					return err
				}
				board.Revision++
				if err = tx.Save(&board).Error; err != nil {
					return err
				}
				row.Applied = true
			}
		}
		return tx.Save(&row).Error
	})
}
