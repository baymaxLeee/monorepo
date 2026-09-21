package benefitpackage

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/plugin/soft_delete"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/scopelifecycle"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationasset "github.com/example/monorepo/canvas/internal/server/application/asset"
	applicationpackage "github.com/example/monorepo/canvas/internal/server/application/benefitpackage"
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
	domainpackage "github.com/example/monorepo/canvas/internal/server/domain/benefitpackage"
)

type Repository struct{ db *gorm.DB }

const maxBatchAssetReviewResults = 200

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, item domainpackage.Package) error {
	row, models, err := rowsFromDomain(item)
	if err != nil {
		return err
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := scopelifecycle.LockActive(tx, item.TenantID, nil); err != nil {
			return err
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if len(models) == 0 {
			return nil
		}
		return tx.Create(&models).Error
	})
	return translateWriteError(err)
}

func (r *Repository) Get(ctx context.Context, scope applicationpackage.Scope, packageID string) (domainpackage.Package, error) {
	id, err := parseID(packageID)
	if err != nil {
		return domainpackage.Package{}, applicationpackage.ErrNotFound
	}
	var row packageRow
	if err = r.db.WithContext(ctx).Where("tenant_id = ? AND id = ?", scope.TenantID, id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domainpackage.Package{}, applicationpackage.ErrNotFound
		}
		return domainpackage.Package{}, fmt.Errorf("get benefit package: %w", err)
	}
	models, err := r.loadModels(ctx, scope.TenantID, []persistenceid.UUID{id})
	if err != nil {
		return domainpackage.Package{}, err
	}
	usage, err := r.loadUsage(ctx, scope.TenantID, []persistenceid.UUID{id})
	if err != nil {
		return domainpackage.Package{}, err
	}
	return domainFromRow(row, models[id.String()], usage[id.String()]), nil
}

func (r *Repository) Update(ctx context.Context, item domainpackage.Package, expectedRevision int64) error {
	row, models, err := rowsFromDomain(item)
	if err != nil {
		return err
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current packageRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND id = ?", row.TenantID, row.ID).First(&current).Error; err != nil {
			return err
		}
		if current.Revision != expectedRevision {
			return applicationpackage.ErrRevisionConflict
		}
		if err := tx.Model(&current).Updates(map[string]any{
			"name": row.Name, "project_name": row.ProjectName, "asset_group_id": row.AssetGroupID, "encrypted_access_key_id": row.EncryptedAccessKeyID,
			"encrypted_secret_access_key": row.EncryptedSecretAccessKey, "enabled": row.Enabled, "scope_type": row.ScopeType,
			"revision": row.Revision, "updated_by": row.UpdatedBy, "updated_at": row.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("tenant_id = ? AND package_id = ?", row.TenantID, row.ID).Delete(&packageModelRow{}).Error; err != nil {
			return err
		}
		if len(models) == 0 {
			return nil
		}
		return tx.Create(&models).Error
	})
	return translateWriteError(err)
}

func (r *Repository) Delete(
	ctx context.Context,
	item domainpackage.Package,
	expectedRevision int64,
	deleteExternalReviewedAssets bool,
) ([]applicationpackage.AssetReviewRecord, error) {
	if item.DeletedAt == nil {
		return nil, applicationpackage.ErrNotFound
	}
	id, err := parseID(item.ID)
	if err != nil {
		return nil, applicationpackage.ErrNotFound
	}
	var records []applicationpackage.AssetReviewRecord
	err = persistencetransaction.DB(ctx, r.db).Transaction(func(tx *gorm.DB) error {
		var reviewRows []assetReviewRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("tenant_id = ? AND package_id = ?", item.TenantID, id).
			Order("created_at ASC, id ASC").Find(&reviewRows).Error; err != nil {
			return fmt.Errorf("find package asset reviews for retirement: %w", err)
		}
		var current packageRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND id = ?", item.TenantID, id).First(&current).Error; err != nil {
			return err
		}
		if current.Revision != expectedRevision {
			return applicationpackage.ErrRevisionConflict
		}
		records = make([]applicationpackage.AssetReviewRecord, 0, len(reviewRows))
		reviewIDs := make([]persistenceid.UUID, 0, len(reviewRows))
		outbox := make([]assetReviewCleanupOutboxRow, 0, len(reviewRows))
		for _, row := range reviewRows {
			records = append(records, reviewRecordFromRow(row))
			reviewIDs = append(reviewIDs, row.ID)
			if !deleteExternalReviewedAssets || strings.TrimSpace(row.ProviderAssetID) == "" {
				continue
			}
			outbox = append(outbox, assetReviewCleanupOutboxRow{
				ReviewID: row.ID, AssetID: row.AssetID, PackageID: row.PackageID, TenantID: row.TenantID,
				ProviderAssetID: row.ProviderAssetID, ProjectName: current.ProjectName,
				EncryptedAccessKeyID: current.EncryptedAccessKeyID, EncryptedSecretAccessKey: current.EncryptedSecretAccessKey,
				QuotaReservationID: row.QuotaReservationID, Status: applicationpackage.ReviewCleanupStatusPending,
				NextAttemptAt: item.UpdatedAt.UTC(), StateVersion: 1, CreatedAt: item.UpdatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC(),
			})
		}
		if len(outbox) > 0 {
			if err := tx.Create(&outbox).Error; err != nil {
				return fmt.Errorf("enqueue package asset review cleanup: %w", err)
			}
		}
		deletedAt := soft_delete.DeletedAt(item.DeletedAt.UnixMilli())
		if len(reviewIDs) > 0 {
			if err := tx.Model(&assetReviewRow{}).Where("id IN ?", reviewIDs).
				Updates(map[string]any{"deleted_at": deletedAt, "updated_at": item.UpdatedAt.UTC()}).Error; err != nil {
				return fmt.Errorf("retire package asset reviews: %w", err)
			}
		}
		if err := tx.Model(&packageModelRow{}).Where("tenant_id = ? AND package_id = ?", item.TenantID, id).Update("deleted_at", deletedAt).Error; err != nil {
			return err
		}
		return tx.Model(&current).Updates(map[string]any{"revision": item.Revision, "updated_by": item.UpdatedBy, "updated_at": item.UpdatedAt, "deleted_at": deletedAt}).Error
	})
	if err != nil {
		return nil, translateWriteError(err)
	}
	return records, nil
}

func (r *Repository) List(ctx context.Context, scope applicationpackage.Scope) ([]domainpackage.Package, error) {
	var rows []packageRow
	if err := r.db.WithContext(ctx).Where("tenant_id = ?", scope.TenantID).Order("is_preset DESC").Order("created_at ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list benefit packages: %w", err)
	}
	ids := make([]persistenceid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	models, err := r.loadModels(ctx, scope.TenantID, ids)
	if err != nil {
		return nil, err
	}
	usage, err := r.loadUsage(ctx, scope.TenantID, ids)
	if err != nil {
		return nil, err
	}
	items := make([]domainpackage.Package, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row, models[row.ID.String()], usage[row.ID.String()]))
	}
	return items, nil
}

func rowsFromDomain(item domainpackage.Package) (packageRow, []packageModelRow, error) {
	id, err := parseID(item.ID)
	if err != nil {
		return packageRow{}, nil, err
	}
	row := packageRow{ID: id, TenantID: item.TenantID, IsPreset: item.IsPreset, Name: item.Name, ProjectName: item.ProjectName, AssetGroupID: item.AssetGroupID, EncryptedAccessKeyID: item.EncryptedAccessKeyID, EncryptedSecretAccessKey: item.EncryptedSecretAccessKey, Enabled: item.Enabled, ScopeType: string(item.ScopeType), Revision: item.Revision, CreatedBy: item.CreatedBy, UpdatedBy: item.UpdatedBy, CreatedAt: item.CreatedAt.UTC(), UpdatedAt: item.UpdatedAt.UTC()}
	models := make([]packageModelRow, 0, len(item.ModelIDs))
	for _, modelID := range item.ModelIDs {
		models = append(models, packageModelRow{TenantID: item.TenantID, PackageID: id, ModelID: modelID, CreatedAt: item.UpdatedAt.UTC()})
	}
	return row, models, nil
}

func domainFromRow(row packageRow, modelIDs []string, usage int64) domainpackage.Package {
	return domainpackage.Package{ID: row.ID.String(), TenantID: row.TenantID, IsPreset: row.IsPreset, Name: row.Name, ProjectName: row.ProjectName, AssetGroupID: row.AssetGroupID, EncryptedAccessKeyID: row.EncryptedAccessKeyID, EncryptedSecretAccessKey: row.EncryptedSecretAccessKey, Enabled: row.Enabled, ScopeType: domainpackage.ScopeType(row.ScopeType), ModelIDs: modelIDs, MaterialUsed: usage, Revision: row.Revision, CreatedBy: row.CreatedBy, UpdatedBy: row.UpdatedBy, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
}

func (r *Repository) loadModels(ctx context.Context, tenantID string, ids []persistenceid.UUID) (map[string][]string, error) {
	result := make(map[string][]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []packageModelRow
	if err := r.db.WithContext(ctx).Where("tenant_id = ? AND package_id IN ?", tenantID, ids).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load package models: %w", err)
	}
	for _, row := range rows {
		key := row.PackageID.String()
		result[key] = append(result[key], row.ModelID)
	}
	return result, nil
}

func (r *Repository) loadUsage(ctx context.Context, tenantID string, ids []persistenceid.UUID) (map[string]int64, error) {
	result := make(map[string]int64, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []struct {
		PackageID persistenceid.UUID
		Count     int64
	}
	if err := r.db.WithContext(ctx).Model(&assetReviewRow{}).Select("package_id, COUNT(DISTINCT asset_id) AS count").Where("tenant_id = ? AND package_id IN ? AND submitted_at IS NOT NULL", tenantID, ids).Group("package_id").Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("aggregate package material usage: %w", err)
	}
	for _, row := range rows {
		result[row.PackageID.String()] = row.Count
	}
	return result, nil
}

func (r *Repository) ReplaceAssetReview(ctx context.Context, input applicationpackage.ReserveAssetReviewInput) (applicationpackage.ReplaceAssetReviewResult, error) {
	row, err := reviewRowFromReserve(input)
	if err != nil {
		return applicationpackage.ReplaceAssetReviewResult{}, err
	}
	db := persistencetransaction.DB(ctx, r.db)
	result := applicationpackage.ReplaceAssetReviewResult{Current: reviewRecordFromRow(row)}
	err = db.Transaction(func(tx *gorm.DB) error {
		var oldRows []assetReviewRow
		reviewsForReplacement := func(query *gorm.DB) *gorm.DB {
			return query.Unscoped().Where(
				"tenant_id = ? AND asset_id = ? AND package_id = ?", row.TenantID, row.AssetID, row.PackageID,
			).Order("created_at ASC, id ASC")
		}
		// Do not lock an absent key: under MySQL REPEATABLE READ the resulting gap lock can
		// deadlock concurrent first submissions for other packages on the same asset. The
		// unique index arbitrates concurrent inserts for the exact same empty key instead.
		if findErr := reviewsForReplacement(tx).Find(&oldRows).Error; findErr != nil {
			return fmt.Errorf("find asset review for replacement: %w", findErr)
		}
		if len(oldRows) > 0 {
			oldRows = nil
			if findErr := reviewsForReplacement(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Find(&oldRows).Error; findErr != nil {
				return fmt.Errorf("lock asset review for replacement: %w", findErr)
			}
		}
		for _, old := range oldRows {
			// A provider asset created by an in-flight submission cannot be recovered until its ID is persisted.
			// Reject an overlapping replacement during that window so it cannot orphan the eventual provider asset.
			if old.DeletedAt == 0 && domainasset.ReviewStatus(old.Status) == domainasset.ReviewStatusSubmitting && strings.TrimSpace(old.ProviderAssetID) == "" {
				return applicationpackage.ErrReviewStateConflict
			}
		}
		result.Replaced = make([]applicationpackage.AssetReviewRecord, 0, len(oldRows))
		cleanupRows := make([]assetReviewCleanupOutboxRow, 0, len(oldRows))
		oldIDs := make([]persistenceid.UUID, 0, len(oldRows))
		var currentPackage packageRow
		needsProviderCleanup := false
		for _, old := range oldRows {
			if old.DeletedAt == 0 && strings.TrimSpace(old.ProviderAssetID) != "" {
				needsProviderCleanup = true
				break
			}
		}
		if needsProviderCleanup {
			if findErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
				"tenant_id = ? AND id = ?", row.TenantID, row.PackageID,
			).First(&currentPackage).Error; findErr != nil {
				return fmt.Errorf("find current package for replaced asset review cleanup: %w", findErr)
			}
		}
		for _, old := range oldRows {
			oldIDs = append(oldIDs, old.ID)
			if old.DeletedAt != 0 {
				continue
			}
			result.Replaced = append(result.Replaced, reviewRecordFromRow(old))
			if strings.TrimSpace(old.ProviderAssetID) == "" {
				continue
			}
			cleanupRows = append(cleanupRows, assetReviewCleanupOutboxRow{
				ReviewID: old.ID, AssetID: old.AssetID, PackageID: old.PackageID, TenantID: old.TenantID,
				ProviderAssetID: old.ProviderAssetID, ProjectName: currentPackage.ProjectName,
				EncryptedAccessKeyID: currentPackage.EncryptedAccessKeyID, EncryptedSecretAccessKey: currentPackage.EncryptedSecretAccessKey,
				QuotaReservationID: old.QuotaReservationID, Status: applicationpackage.ReviewCleanupStatusPending,
				NextAttemptAt: input.Now.UTC(), StateVersion: 1, CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
			})
		}
		if len(cleanupRows) > 0 {
			if createErr := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&cleanupRows).Error; createErr != nil {
				return fmt.Errorf("enqueue replaced asset review cleanup: %w", createErr)
			}
		}
		if len(oldIDs) > 0 {
			if deleteErr := tx.Unscoped().Where("id IN ?", oldIDs).Delete(&assetReviewRow{}).Error; deleteErr != nil {
				return fmt.Errorf("delete replaced asset reviews: %w", deleteErr)
			}
		}
		if createErr := tx.Create(&row).Error; createErr != nil {
			return translateReviewWriteError(createErr)
		}
		return nil
	})
	if err != nil {
		return applicationpackage.ReplaceAssetReviewResult{}, err
	}
	return result, nil
}

func (r *Repository) SetAssetReviewQuotaReservation(
	ctx context.Context,
	reviewID string,
	reservationID string,
	now time.Time,
) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).
		Where("id = ? AND status = ? AND quota_reservation_id = ''", id, domainasset.ReviewStatusSubmitting).
		Updates(map[string]any{"quota_reservation_id": reservationID, "updated_at": now.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) MarkAssetReviewSubmissionStarted(ctx context.Context, reviewID, taskRunID string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).
		Where("id = ? AND task_run_id = ? AND status = ? AND submission_started_at IS NULL", id, taskRunID, domainasset.ReviewStatusSubmitting).
		Updates(map[string]any{"submission_started_at": now.UTC(), "updated_at": now.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) ResetAssetReviewSubmission(ctx context.Context, reviewID, taskRunID string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).
		Where("id = ? AND task_run_id = ? AND status = ? AND submission_started_at IS NOT NULL", id, taskRunID, domainasset.ReviewStatusSubmitting).
		Updates(map[string]any{"submission_started_at": nil, "updated_at": now.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) MarkAssetReviewProcessing(ctx context.Context, reviewID, taskRunID, providerAssetID string, submittedAt time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).
		Where("id = ? AND task_run_id = ? AND status = ?", id, taskRunID, domainasset.ReviewStatusSubmitting).
		Updates(map[string]any{"provider_asset_id": providerAssetID, "status": domainasset.ReviewStatusProcessing, "submitted_at": submittedAt.UTC(), "updated_at": submittedAt.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) MarkAssetReviewFailed(ctx context.Context, reviewID, reason string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).
		Where("id = ? AND status = ?", id, domainasset.ReviewStatusSubmitting).
		Updates(map[string]any{"status": domainasset.ReviewStatusFailed, "failure_reason": reason, "updated_at": now.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) GetAssetReviewByTaskRun(ctx context.Context, taskRunID string) (applicationpackage.AssetReviewRecord, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return applicationpackage.AssetReviewRecord{}, applicationpackage.ErrReviewNotFound
	}
	var row assetReviewRow
	if err = persistencetransaction.DB(ctx, r.db).Where("task_run_id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return applicationpackage.AssetReviewRecord{}, applicationpackage.ErrReviewNotFound
		}
		return applicationpackage.AssetReviewRecord{}, fmt.Errorf("get asset review by task run: %w", err)
	}
	return reviewRecordFromRow(row), nil
}

func (r *Repository) MarkAssetReviewTerminal(ctx context.Context, reviewID string, status domainasset.ReviewStatus, reason string, now time.Time) error {
	if status != domainasset.ReviewStatusApproved && status != domainasset.ReviewStatusFailed {
		return fmt.Errorf("unsupported terminal asset review status %q", status)
	}
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).
		Where("id = ? AND status = ?", id, domainasset.ReviewStatusProcessing).
		Updates(map[string]any{"status": status, "failure_reason": reason, "updated_at": now.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) RetireAssetReviews(ctx context.Context, scope applicationasset.Scope, assetID string, now time.Time) ([]applicationpackage.AssetReviewRecord, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return nil, nil
	}
	query := persistencetransaction.DB(ctx, r.db).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("tenant_id = ? AND asset_id = ?", scope.TenantID, id)
	if scope.WorkspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *scope.WorkspaceID)
	}
	var rows []assetReviewRow
	if err = query.Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("find asset reviews for retirement: %w", err)
	}
	if len(rows) == 0 {
		return []applicationpackage.AssetReviewRecord{}, nil
	}
	ids := make([]persistenceid.UUID, 0, len(rows))
	records := make([]applicationpackage.AssetReviewRecord, 0, len(rows))
	packageIDs := make([]persistenceid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		packageIDs = append(packageIDs, row.PackageID)
		records = append(records, reviewRecordFromRow(row))
	}
	var packages []packageRow
	if err = persistencetransaction.DB(ctx, r.db).Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND id IN ?", scope.TenantID, packageIDs).Order("id ASC").Find(&packages).Error; err != nil {
		return nil, fmt.Errorf("find packages for asset review cleanup: %w", err)
	}
	packageByID := make(map[persistenceid.UUID]packageRow, len(packages))
	for _, item := range packages {
		packageByID[item.ID] = item
	}
	outbox := make([]assetReviewCleanupOutboxRow, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.ProviderAssetID) == "" {
			continue
		}
		item, exists := packageByID[row.PackageID]
		if !exists {
			return nil, fmt.Errorf("find package %s for asset review cleanup: %w", row.PackageID.String(), applicationpackage.ErrNotFound)
		}
		outbox = append(outbox, assetReviewCleanupOutboxRow{
			ReviewID: row.ID, AssetID: row.AssetID, PackageID: row.PackageID, TenantID: row.TenantID,
			ProviderAssetID: row.ProviderAssetID, ProjectName: item.ProjectName,
			EncryptedAccessKeyID: item.EncryptedAccessKeyID, EncryptedSecretAccessKey: item.EncryptedSecretAccessKey,
			QuotaReservationID: row.QuotaReservationID, Status: applicationpackage.ReviewCleanupStatusPending,
			NextAttemptAt: now.UTC(), StateVersion: 1, CreatedAt: now.UTC(), UpdatedAt: now.UTC(),
		})
	}
	if len(outbox) > 0 {
		if err = persistencetransaction.DB(ctx, r.db).Create(&outbox).Error; err != nil {
			return nil, fmt.Errorf("enqueue asset review cleanup: %w", err)
		}
	}
	if err = persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id IN ?", ids).
		Updates(map[string]any{"deleted_at": soft_delete.DeletedAt(now.UnixMilli()), "updated_at": now.UTC()}).Error; err != nil {
		return nil, fmt.Errorf("retire asset reviews: %w", err)
	}
	return records, nil
}

func (r *Repository) BatchGetAssetReviews(ctx context.Context, scope applicationasset.Scope, assetIDs []string) (map[string][]domainasset.Review, error) {
	return r.batchGetAssetReviews(ctx, scope.TenantID, scope.WorkspaceID, nil, assetIDs)
}

func (r *Repository) BatchGetProjectAssetReviews(ctx context.Context, scope applicationpackage.ReviewScope, projectID string, assetIDs []string) (map[string][]domainasset.Review, error) {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return map[string][]domainasset.Review{}, nil
	}
	return r.batchGetAssetReviews(ctx, scope.TenantID, scope.WorkspaceID, &id, assetIDs)
}

func (r *Repository) batchGetAssetReviews(ctx context.Context, tenantID string, workspaceID *string, projectID *persistenceid.UUID, assetIDs []string) (map[string][]domainasset.Review, error) {
	result := make(map[string][]domainasset.Review)
	ids := persistenceid.ParseValid(assetIDs)
	if len(ids) == 0 {
		return result, nil
	}
	db := persistencetransaction.DB(ctx, r.db)
	query := db.Where("tenant_id = ? AND asset_id IN ?", tenantID, ids)
	if projectID != nil {
		query = query.Where("project_id = ?", *projectID)
	}
	if workspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *workspaceID)
	}
	var rows []assetReviewRow
	if err := query.Order("created_at DESC, id DESC").Limit(maxBatchAssetReviewResults).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("batch get asset reviews: %w", err)
	}
	packageIDs := make([]persistenceid.UUID, 0, len(rows))
	seenPackages := make(map[persistenceid.UUID]struct{}, len(rows))
	for _, row := range rows {
		if _, ok := seenPackages[row.PackageID]; ok {
			continue
		}
		seenPackages[row.PackageID] = struct{}{}
		packageIDs = append(packageIDs, row.PackageID)
	}
	modelsByPackage := make(map[persistenceid.UUID][]string, len(packageIDs))
	if len(packageIDs) > 0 {
		var models []packageModelRow
		if err := db.Where("tenant_id = ? AND package_id IN ?", tenantID, packageIDs).Order("package_id ASC, model_id ASC").Find(&models).Error; err != nil {
			return nil, fmt.Errorf("load asset review package models: %w", err)
		}
		for _, model := range models {
			modelsByPackage[model.PackageID] = append(modelsByPackage[model.PackageID], model.ModelID)
		}
	}
	for _, row := range rows {
		review := domainasset.Review{PackageID: row.PackageID.String(), PackageName: row.PackageName, ModelIDs: modelsByPackage[row.PackageID], SystemPresetModels: domainpackage.ScopeType(row.ScopeType) == domainpackage.ScopeSystemPresetModels, ProviderAssetID: row.ProviderAssetID, Status: domainasset.ReviewStatus(row.Status), FailureReason: row.FailureReason, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
		if row.SubmittedAt != nil {
			review.SubmittedAt = row.SubmittedAt.UTC()
		}
		assetID := row.AssetID.String()
		result[assetID] = append(result[assetID], review)
	}
	for assetID := range result {
		reviews := result[assetID]
		for left, right := 0, len(reviews)-1; left < right; left, right = left+1, right-1 {
			reviews[left], reviews[right] = reviews[right], reviews[left]
		}
	}
	return result, nil
}

func reviewRowFromReserve(input applicationpackage.ReserveAssetReviewInput) (assetReviewRow, error) {
	id, err := persistenceid.Parse(input.ID)
	if err != nil {
		return assetReviewRow{}, err
	}
	taskRunID, err := persistenceid.Parse(input.TaskRunID)
	if err != nil {
		return assetReviewRow{}, err
	}
	projectID, err := persistenceid.Parse(input.ProjectID)
	if err != nil {
		return assetReviewRow{}, err
	}
	packageID, err := persistenceid.Parse(input.PackageID)
	if err != nil {
		return assetReviewRow{}, err
	}
	assetID, err := persistenceid.Parse(input.AssetID)
	if err != nil {
		return assetReviewRow{}, err
	}
	return assetReviewRow{
		ID: id, TaskRunID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, ProjectID: projectID,
		PackageID: packageID, PackageName: input.PackageName, ScopeType: string(input.ScopeType), AssetID: assetID,
		Status:    string(domainasset.ReviewStatusSubmitting),
		CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
	}, nil
}

func reviewRecordFromRow(row assetReviewRow) applicationpackage.AssetReviewRecord {
	return applicationpackage.AssetReviewRecord{
		ID: row.ID.String(), TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID,
		ProjectID: row.ProjectID.String(), PackageID: row.PackageID.String(), PackageName: row.PackageName, AssetID: row.AssetID.String(),
		ProviderAssetID:     row.ProviderAssetID,
		QuotaReservationID:  row.QuotaReservationID,
		SubmissionStartedAt: row.SubmissionStartedAt,
		Status:              domainasset.ReviewStatus(row.Status), ScopeType: domainpackage.ScopeType(row.ScopeType), FailureReason: row.FailureReason, SubmittedAt: row.SubmittedAt,
		CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(),
	}
}

func reviewUpdateResult(result *gorm.DB) error {
	if result.Error != nil {
		return fmt.Errorf("update asset review: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return applicationpackage.ErrReviewStateConflict
	}
	return nil
}

func translateReviewWriteError(err error) error {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "uniq_asset_reviews_tenant_asset_package") ||
		strings.Contains(message, "asset_reviews.tenant_id, asset_reviews.asset_id, asset_reviews.package_id") {
		return applicationpackage.ErrReviewStateConflict
	}
	return fmt.Errorf("persist asset review: %w", err)
}

func parseID(value string) (persistenceid.UUID, error) { return persistenceid.Parse(value) }

func translateWriteError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationpackage.ErrNotFound
	}
	if errors.Is(err, applicationpackage.ErrRevisionConflict) {
		return err
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "uniq_package_models_tenant_model_active") || strings.Contains(message, "package_models.tenant_id, package_models.model_id") {
		return applicationpackage.ErrModelConflict
	}
	if strings.Contains(message, "uniq_packages_tenant_name_active") || strings.Contains(message, "packages.tenant_id, packages.name") {
		return applicationpackage.ErrNameConflict
	}
	return fmt.Errorf("persist benefit package: %w", err)
}
