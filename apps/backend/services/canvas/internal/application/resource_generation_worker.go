package application

import (
	"context"
	"encoding/json"
	"github.com/example/monorepo/canvas/internal/infrastructure/executor"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	repo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/resourceassetgeneration"
	draftapp "github.com/example/monorepo/canvas/internal/server/application/resourceassetgeneration"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"log/slog"
	"sync"
	"time"
)

func (s *Service) RunResourceGenerations(ctx context.Context) {
	var active sync.Map
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		var rows []p.ResourceGeneration
		if err := s.DB.WithContext(ctx).Where("status IN ?", []string{"queued", "running"}).Find(&rows).Error; err != nil {
			if ctx.Err() == nil {
				slog.Error("resource generation reconciliation failed", "error", err)
			}
		} else {
			for _, row := range rows {
				if _, loaded := active.LoadOrStore(row.ID, true); loaded {
					continue
				}
				go func(row p.ResourceGeneration) {
					defer active.Delete(row.ID)
					if err := s.runResourceGeneration(ctx, row); err != nil && ctx.Err() == nil {
						slog.Warn("resource generation will reconnect", "run_id", row.ID, "error", err)
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
func (s *Service) runResourceGeneration(ctx context.Context, row p.ResourceGeneration) error {
	requested, checkErr := s.resourceGenerationCancellation(ctx, row.ID)
	if checkErr != nil {
		return checkErr
	}
	row.CancelRequested = requested
	task := executor.Task{Status: "cancelled"}
	if row.CancelRequested && row.TaskID == "" {
		var err error
		task, err = s.Executor.CancelByOwner(ctx, row.ID, row.TaskType)
		if err != nil {
			return err
		}
		row.TaskID = task.ID
	}
	if !row.CancelRequested || row.TaskID != "" {
		var err error
		task, err = s.Executor.Start(ctx, row.ID, row.TaskType, json.RawMessage(row.InputPayload))
		if err != nil {
			return err
		}
		if err = s.DB.WithContext(ctx).Model(&p.ResourceGeneration{}).Where("id = ? AND status IN ?", row.ID, []string{"queued", "running"}).Updates(map[string]any{"task_id": task.ID, "status": "running"}).Error; err != nil {
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
				return s.resourceGenerationCancellation(checkCtx, row.ID)
			})
			if err != nil {
				return err
			}
		}
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var project p.Project
		if err := tx.Unscoped().Clauses(clause.Locking{Strength: "SHARE"}).First(&project, "id = ?", row.ProjectID).Error; err != nil {
			return err
		}
		var resource p.Resource
		if err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).First(&resource, "id = ?", row.ResourceID).Error; err != nil {
			return err
		}
		var slot p.ResourceAsset
		if err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).First(&slot, "id = ?", row.ResourceAssetID).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", row.ID).Error; err != nil {
			return err
		}
		if executor.Terminal(row.Status) {
			return nil
		}
		row.Status = task.Status
		if row.CancelRequested || project.DeletedAt.Valid || resource.DeletedAt.Valid || slot.DeletedAt.Valid {
			row.Status = "cancelled"
		}
		if row.Status == "failed" {
			row.Error = "生成失败，请检查模型配置后重试"
		}
		if row.Status == "completed" {
			if task.Result.ObjectKey == "" {
				row.Status = "failed"
				row.Error = "模型未返回图片"
			} else {
				asset := p.Asset{ID: newID(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID, ObjectKey: task.Result.ObjectKey, MimeType: task.Result.MimeType}
				if err := tx.Create(&asset).Error; err != nil {
					return err
				}
				var version int64
				if err := tx.Model(&p.ResourceAssetRevision{}).Where("resource_asset_id = ?", slot.ID).Select("COALESCE(MAX(revision_no),0)").Scan(&version).Error; err != nil {
					return err
				}
				if err := tx.Create(&p.ResourceAssetRevision{ResourceAssetID: slot.ID, AssetID: asset.ID, MediaType: 1, RevisionNo: version + 1, CreatedAt: time.Now()}).Error; err != nil {
					return err
				}
				if err := tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "RESOURCE_ASSET_REVISION", OwnerKey: slot.ID}).Error; err != nil {
					return err
				}
				row.OutputAssetID = asset.ID
				slot.CurrentAssetID = asset.ID
				slot.Revision++
				resource.Revision++
				row.Applied = true
				if err := tx.Save(&slot).Error; err != nil {
					return err
				}
				if err := tx.Save(&resource).Error; err != nil {
					return err
				}
			}
		}
		a := Actor{TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, UserID: row.UserID}
		if _, err := repo.NewRepository(tx).ClearActiveTaskRun(ctx, draftapp.DraftScope{TenantID: a.TenantID, WorkspaceID: &a.WorkspaceID, CallerID: a.UserID}, slot.ID, row.ID); err != nil {
			return err
		}
		return tx.Save(&row).Error
	})
}
