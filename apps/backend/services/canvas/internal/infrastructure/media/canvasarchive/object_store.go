package canvasarchive

import (
	"context"

	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	"github.com/example/monorepo/canvas/internal/infrastructure/artifact"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
)

type ObjectStore struct {
	db      *gorm.DB
	storage *storage.Client
}

func NewObjectStore(db *gorm.DB, storageClient *storage.Client) *ObjectStore {
	return &ObjectStore{db: db, storage: storageClient}
}

func (store *ObjectStore) Delete(ctx context.Context, item applicationcanvasarchive.Export) error {
	namespace, err := archiveNamespace(item)
	if err != nil {
		return err
	}
	archiveOwners := store.db.WithContext(ctx).Table("canvas_video_archive_exports").
		Where("task_run_id <> ? AND tenant_id = ? AND project_id = ? AND output_path = ? AND cleanup_status <> ?",
			item.TaskRunID, item.TenantID, item.ProjectID, item.OutputPath, applicationcanvasarchive.CleanupStatusCompleted)
	assetOwners := store.db.WithContext(ctx).Table("assets").
		Where("tenant_id = ? AND artifact_namespace = ? AND artifact_id = ?", item.TenantID, namespace, item.OutputPath)
	if item.WorkspaceID == nil {
		archiveOwners = archiveOwners.Where("workspace_id IS NULL")
		assetOwners = assetOwners.Where("workspace_id IS NULL")
	} else {
		archiveOwners = archiveOwners.Where("workspace_id = ?", *item.WorkspaceID)
		assetOwners = assetOwners.Where("workspace_id = ?", *item.WorkspaceID)
	}
	var count int64
	if err = archiveOwners.Count(&count).Error; err != nil || count > 0 {
		return err
	}
	if err = assetOwners.Count(&count).Error; err != nil || count > 0 {
		return err
	}
	return store.storage.Delete(ctx, artifact.KnowledgeNamespace(namespace), item.OutputPath)
}
