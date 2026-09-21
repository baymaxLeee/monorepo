package application

import (
	"context"
	"log/slog"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	archiveRepo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/canvasarchive"
	archive "github.com/example/monorepo/canvas/internal/server/application/canvasarchive"
	"gorm.io/gorm"
)

const (
	archiveCleanupMinute = 20
	archiveCleanupBudget = 30 * time.Minute
)

type archiveObjectStore struct {
	db      *gorm.DB
	storage *storage.Client
}

func (s archiveObjectStore) Delete(ctx context.Context, _ string, taskRunID string) error {
	item, err := archiveRepo.NewRepository(s.db).GetByTaskRunID(ctx, taskRunID)
	if err != nil || item.OutputPath == "" || item.WorkspaceID == nil {
		return err
	}
	var otherArchives int64
	err = s.db.WithContext(ctx).Table("canvas_video_archive_exports").
		Where("task_run_id <> ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND output_path = ? AND cleanup_status <> ?",
			taskRunID, item.TenantID, *item.WorkspaceID, item.ProjectID, item.OutputPath, archive.CleanupStatusCompleted).
		Count(&otherArchives).Error
	if err != nil || otherArchives > 0 {
		return err
	}
	var assetReferences int64
	err = s.db.WithContext(ctx).Table("assets").
		Where("tenant_id = ? AND workspace_id = ? AND project_id = ? AND object_key = ? AND deleted_at IS NULL",
			item.TenantID, *item.WorkspaceID, item.ProjectID, item.OutputPath).
		Count(&assetReferences).Error
	if err != nil || assetReferences > 0 {
		return err
	}
	return s.storage.Delete(ctx, storage.Scope(item.TenantID, *item.WorkspaceID, item.ProjectID), item.OutputPath)
}

func (s *Service) RunArchiveCleanup(ctx context.Context) {
	cleaner := archive.NewCleaner(
		archiveRepo.NewRepository(s.DB),
		archiveObjectStore{db: s.DB, storage: s.Storage},
		nil,
		archiveClock{},
	)
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), archiveCleanupMinute, 0, 0, now.Location())
		if !next.After(now) {
			next = next.Add(time.Hour)
		}
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if count, err := cleaner.CleanupDue(ctx, archiveCleanupBudget); err != nil && ctx.Err() == nil {
			slog.Error("canvas archive cleanup round failed", "claimed", count, "error", err)
		}
	}
}
