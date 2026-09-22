package quota

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
)

func (r *Repository) BackfillStorageLedger(
	ctx context.Context,
	now time.Time,
) (applicationquota.StorageBackfillResult, error) {
	result := applicationquota.StorageBackfillResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := backfillAssetBillingClasses(tx); err != nil {
			return err
		}
		objects, incomplete, err := loadStorageBackfillObjects(tx)
		if err != nil {
			return err
		}
		result.Incomplete = incomplete
		loggedConflicts := 0
		for _, object := range objects {
			complete, ensureErr := ensureBackfillStorageObject(tx, object, now)
			if ensureErr != nil {
				return ensureErr
			}
			if !complete {
				result.Incomplete++
				if loggedConflicts < 50 {
					r.log.Warn("storage quota backfill conflict", zap.String("tenant_id", object.TenantID), zap.String("object_type", object.ObjectType), zap.String("owner_id", object.OwnerID))
					loggedConflicts++
				}
			}
		}
		if err := reconcileArtifactStorageStatuses(tx, now); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return applicationquota.StorageBackfillResult{}, fmt.Errorf("backfill storage ledger: %w", err)
	}
	return result, nil
}

func backfillAssetBillingClasses(tx *gorm.DB) error {
	var assetCount int64
	if err := tx.Table("assets").Count(&assetCount).Error; err != nil {
		return fmt.Errorf("count historical Assets: %w", err)
	}
	if assetCount == 0 {
		return nil
	}

	var generatedImageCount int64
	if err := tx.Table("assets").Where(
		"creation_key LIKE ? AND billing_class <> ?",
		"image-generation:%", applicationquota.BillingBillable,
	).Count(&generatedImageCount).Error; err != nil {
		return fmt.Errorf("count historical generated image billing classes: %w", err)
	}
	if generatedImageCount > 0 {
		if err := tx.Table("assets").
			Where("creation_key LIKE ?", "image-generation:%").
			Update("billing_class", applicationquota.BillingBillable).Error; err != nil {
			return fmt.Errorf("upgrade historical generated image billing classes: %w", err)
		}
	}
	if tx.Migrator().HasTable("canvas_node_generations") {
		for _, column := range []string{"asset_id", "first_frame_asset_id", "last_frame_asset_id"} {
			generatedIDs := tx.Table("canvas_node_generations").
				Select(column).Where(column + " IS NOT NULL")
			var generatedVideoCount int64
			if err := tx.Table("assets").Where(
				"billing_class <> ? AND id IN (?)", applicationquota.BillingBillable, generatedIDs,
			).Count(&generatedVideoCount).Error; err != nil {
				return fmt.Errorf("count historical generated video billing classes from %s: %w", column, err)
			}
			if generatedVideoCount > 0 {
				if err := tx.Table("assets").Where("id IN (?)", generatedIDs).
					Update("billing_class", applicationquota.BillingBillable).Error; err != nil {
					return fmt.Errorf("upgrade historical generated video billing classes from %s: %w", column, err)
				}
			}
		}
	}

	var count int64
	if err := tx.Table("assets").Where("billing_class = ''").Count(&count).Error; err != nil {
		return fmt.Errorf("count historical Asset billing classes: %w", err)
	}
	if count == 0 {
		return nil
	}
	result := tx.Table("assets").Where("billing_class = ''").Update(
		"billing_class",
		gorm.Expr(
			"CASE WHEN owner_type = ? THEN ? WHEN creation_key LIKE ? THEN ? ELSE ? END",
			int16(domainasset.OwnerOfficial), applicationquota.BillingBuiltin,
			"resource-import:%", applicationquota.BillingBorrowed,
			applicationquota.BillingBillable,
		),
	)
	if result.Error != nil {
		return fmt.Errorf("backfill historical Asset billing classes: %w", result.Error)
	}
	return nil
}

func loadStorageBackfillObjects(
	tx *gorm.DB,
) ([]applicationquota.StorageObject, int64, error) {
	objects := make([]applicationquota.StorageObject, 0)
	incomplete := int64(0)

	type assetFact struct {
		ID, TenantID, ArtifactID, BillingClass string
		WorkspaceID                            *string
		SizeBytes                              int64
	}
	var assets []assetFact
	if err := tx.Table("assets").
		Select("id, tenant_id, workspace_id, artifact_id, size_bytes, billing_class").
		Order("artifact_id ASC, id ASC").
		Find(&assets).Error; err != nil {
		return nil, 0, fmt.Errorf("load Asset storage facts: %w", err)
	}
	artifactObjects := make(map[string]applicationquota.StorageObject)
	artifactOrder := make([]string, 0)
	for _, item := range assets {
		if item.ArtifactID == "" || item.SizeBytes <= 0 || !validBillingClass(item.BillingClass) {
			incomplete++
			continue
		}
		object := applicationquota.StorageObject{
			TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
			ObjectType: "artifact", ObjectKey: item.ArtifactID, Category: "asset",
			OwnerType: "asset", OwnerID: item.ID, SizeBytes: item.SizeBytes,
			BillingClass: item.BillingClass,
		}
		existing, ok := artifactObjects[item.ArtifactID]
		if !ok {
			artifactObjects[item.ArtifactID] = object
			artifactOrder = append(artifactOrder, item.ArtifactID)
			continue
		}
		if existing.TenantID != object.TenantID ||
			!stringPointersEqual(existing.WorkspaceID, object.WorkspaceID) {
			incomplete++
			continue
		}
		if existing.SizeBytes != object.SizeBytes {
			incomplete++
			existing.SizeBytes = max(existing.SizeBytes, object.SizeBytes)
			artifactObjects[item.ArtifactID] = existing
		}
		// Shared aliases do not allocate another Artifact. Preserve the class of
		// the storage-owning source: tenant-billable beats platform-builtin, and
		// both beat an alias that merely borrows the existing Artifact.
		if billingClassPriority(object.BillingClass) > billingClassPriority(existing.BillingClass) {
			artifactObjects[item.ArtifactID] = object
		}
	}
	for _, artifactID := range artifactOrder {
		objects = append(objects, artifactObjects[artifactID])
	}

	type coverFact struct {
		ID, TenantID, CoverImageID string
		WorkspaceID                *string
		CoverImageSizeBytes        int64
	}
	for _, source := range []struct {
		table, category, ownerType string
	}{
		{table: "projects", category: "project_cover", ownerType: "project_cover"},
		{table: "canvases", category: "canvas_cover", ownerType: "canvas_cover"},
	} {
		var covers []coverFact
		if err := tx.Table(source.table).
			Select("id, tenant_id, workspace_id, cover_image_id, cover_image_size_bytes").
			Where("deleted_at = 0 AND cover_image_id IS NOT NULL").
			Find(&covers).Error; err != nil {
			return nil, 0, fmt.Errorf("load %s storage facts: %w", source.category, err)
		}
		for _, item := range covers {
			if item.CoverImageID == "" || item.CoverImageSizeBytes <= 0 {
				incomplete++
				continue
			}
			objects = append(objects, applicationquota.StorageObject{
				TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
				ObjectType: "cover", ObjectKey: item.CoverImageID, Category: source.category,
				OwnerType: source.ownerType, OwnerID: item.ID, SizeBytes: item.CoverImageSizeBytes,
				BillingClass: applicationquota.BillingBillable,
			})
		}
	}

	type archiveFact struct {
		TaskRunID, TenantID, OutputPath, CleanupStatus string
		WorkspaceID                                    *string
		OutputSize                                     int64
	}
	var archives []archiveFact
	if err := tx.Table("canvas_video_archive_exports").
		Select("task_run_id, tenant_id, workspace_id, output_path, output_size, cleanup_status").
		Where("output_path <> '' AND cleanup_status <> ?", "completed").
		Find(&archives).Error; err != nil {
		return nil, 0, fmt.Errorf("load archive storage facts: %w", err)
	}
	for _, item := range archives {
		if item.OutputSize <= 0 {
			incomplete++
			continue
		}
		objects = append(objects, applicationquota.StorageObject{
			TenantID: item.TenantID, WorkspaceID: item.WorkspaceID,
			ObjectType: "archive_path", ObjectKey: item.OutputPath, Category: "archive_export",
			OwnerType: "canvas_archive", OwnerID: item.TaskRunID, SizeBytes: item.OutputSize,
			BillingClass: applicationquota.BillingBillable,
		})
	}
	return objects, incomplete, nil
}

func ensureBackfillStorageObject(
	tx *gorm.DB,
	object applicationquota.StorageObject,
	now time.Time,
) (bool, error) {
	row := storageRowFromObject(object, now)
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	var existing storageUsageLedgerRow
	if err := tx.Where(
		"object_type = ? AND object_key = ?", object.ObjectType, object.ObjectKey,
	).First(&existing).Error; err != nil {
		return false, err
	}
	// The startup backfill already loaded this object. Resolve only a size
	// disagreement within a proven scope; never scan other sources here.
	sizeConflict := existing.SizeBytes != row.SizeBytes
	comparable := existing
	comparable.SizeBytes = row.SizeBytes
	if sizeConflict && existing.SizeBytes > 0 && row.SizeBytes > 0 &&
		validBillingClass(existing.BillingClass) && validBillingClass(row.BillingClass) &&
		sameBackfillArtifactExceptBillingClass(comparable, row) {
		if err := tx.Model(&storageUsageLedgerRow{}).
			Where("object_type = ? AND object_key = ?", object.ObjectType, object.ObjectKey).
			Update("size_bytes", gorm.Expr("CASE WHEN size_bytes < ? THEN ? ELSE size_bytes END", row.SizeBytes, row.SizeBytes)).Error; err != nil {
			return false, fmt.Errorf("retain larger backfill storage size: %w", err)
		}
		existing.SizeBytes = max(existing.SizeBytes, row.SizeBytes)
		row.SizeBytes = existing.SizeBytes
	}
	if sameBackfillArtifactExceptBillingClass(existing, row) &&
		billingClassPriority(row.BillingClass) > billingClassPriority(existing.BillingClass) {
		if err := tx.Model(&storageUsageLedgerRow{}).
			Where("object_type = ? AND object_key = ?", object.ObjectType, object.ObjectKey).
			Update("billing_class", row.BillingClass).Error; err != nil {
			return false, fmt.Errorf("upgrade historical storage billing class: %w", err)
		}
		existing.BillingClass = row.BillingClass
	}
	return !sizeConflict && sameBackfillStorageObject(existing, row) &&
		(object.ObjectType == "artifact" ||
			(existing.Status == applicationquota.StorageActive ||
				existing.Status == applicationquota.StorageReleasing)), nil
}

func sameBackfillArtifactExceptBillingClass(left, right storageUsageLedgerRow) bool {
	return left.ObjectType == "artifact" && right.ObjectType == "artifact" &&
		left.ObjectKey == right.ObjectKey &&
		left.TenantID == right.TenantID &&
		stringPointersEqual(left.WorkspaceID, right.WorkspaceID) &&
		left.Category == right.Category &&
		left.SizeBytes == right.SizeBytes
}

func sameBackfillStorageObject(left, right storageUsageLedgerRow) bool {
	if left.ObjectType != "artifact" || right.ObjectType != "artifact" {
		return sameStorageObject(left, right)
	}
	// Artifact lifetime is shared across Asset aliases in one workspace. The
	// first owner may be hard-deleted while another alias keeps the Artifact
	// alive, so owner identity is not a stable backfill invariant. A surviving
	// borrowed alias also cannot invalidate or downgrade the ledger's proven
	// storage ownership; use the same monotonic billing rule as runtime writes.
	return left.ObjectType == right.ObjectType &&
		left.ObjectKey == right.ObjectKey &&
		left.TenantID == right.TenantID &&
		stringPointersEqual(left.WorkspaceID, right.WorkspaceID) &&
		left.Category == right.Category &&
		left.SizeBytes == right.SizeBytes &&
		validBillingClass(left.BillingClass) && validBillingClass(right.BillingClass) &&
		billingClassPriority(left.BillingClass) >= billingClassPriority(right.BillingClass)
}

func billingClassPriority(value string) int {
	switch value {
	case applicationquota.BillingBillable:
		return 3
	case applicationquota.BillingBuiltin:
		return 2
	case applicationquota.BillingBorrowed:
		return 1
	default:
		return 0
	}
}

func reconcileArtifactStorageStatuses(tx *gorm.DB, now time.Time) error {
	var count int64
	if err := tx.Model(&storageUsageLedgerRow{}).
		Where("object_type = ?", "artifact").Count(&count).Error; err != nil {
		return fmt.Errorf("count historical Asset storage ledger: %w", err)
	}
	if count == 0 {
		return nil
	}
	activeAsset := tx.Table("assets").
		Select("1").
		Where("assets.artifact_id = tenant_storage_usage_ledger.object_key AND assets.deleted_at = 0")
	anyAsset := tx.Table("assets").
		Select("1").
		Where("assets.artifact_id = tenant_storage_usage_ledger.object_key")

	if err := tx.Model(&storageUsageLedgerRow{}).
		Where(
			"object_type = ? AND EXISTS (?) AND (status <> ? OR released_at IS NOT NULL)",
			"artifact", activeAsset, applicationquota.StorageActive,
		).
		Updates(map[string]any{
			"status": applicationquota.StorageActive, "released_at": nil,
		}).Error; err != nil {
		return fmt.Errorf("activate historical Asset storage ledger: %w", err)
	}
	if err := tx.Model(&storageUsageLedgerRow{}).
		Where(
			"object_type = ? AND NOT EXISTS (?) AND EXISTS (?) AND (status <> ? OR released_at IS NOT NULL)",
			"artifact", activeAsset, anyAsset, applicationquota.StorageReleasing,
		).
		Updates(map[string]any{
			"status": applicationquota.StorageReleasing, "released_at": nil,
		}).Error; err != nil {
		return fmt.Errorf("mark historical Asset storage ledger releasing: %w", err)
	}
	if err := tx.Model(&storageUsageLedgerRow{}).
		Where(
			"object_type = ? AND NOT EXISTS (?) AND (status <> ? OR released_at IS NULL)",
			"artifact", anyAsset, applicationquota.StorageReleased,
		).
		Updates(map[string]any{
			"status": applicationquota.StorageReleased, "released_at": now,
		}).Error; err != nil {
		return fmt.Errorf("release orphaned Asset storage ledger: %w", err)
	}
	return nil
}

func validBillingClass(value string) bool {
	return value == applicationquota.BillingBillable ||
		value == applicationquota.BillingBuiltin ||
		value == applicationquota.BillingBorrowed
}
