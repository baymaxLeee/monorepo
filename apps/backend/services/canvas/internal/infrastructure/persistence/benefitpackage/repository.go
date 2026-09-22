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

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

const maxBatchAssetReviewResults = 200

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) ReplaceAssetReview(ctx context.Context, input applicationpackage.ReserveAssetReviewInput) (applicationpackage.ReplaceAssetReviewResult, error) {
	row, err := reviewRowFromReserve(input)
	if err != nil {
		return applicationpackage.ReplaceAssetReviewResult{}, err
	}
	db := persistencetransaction.DB(ctx, r.db)
	result := applicationpackage.ReplaceAssetReviewResult{Current: reviewRecordFromRow(row)}
	err = db.Transaction(func(tx *gorm.DB) error {
		query := func(db *gorm.DB) *gorm.DB {
			return db.Unscoped().Where("tenant_id = ? AND workspace_id = ? AND asset_id = ? AND package_id = ?", row.TenantID, row.WorkspaceID, row.AssetID, row.PackageID).Order("created_at ASC, id ASC")
		}
		var oldRows []assetReviewRow
		if err := query(tx).Find(&oldRows).Error; err != nil {
			return fmt.Errorf("find asset review for replacement: %w", err)
		}
		if len(oldRows) > 0 {
			oldRows = nil
			if err := query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Find(&oldRows).Error; err != nil {
				return fmt.Errorf("lock asset review for replacement: %w", err)
			}
		}
		for _, old := range oldRows {
			if old.DeletedAt == 0 && domainasset.ReviewStatus(old.Status) == domainasset.ReviewStatusSubmitting && old.SubmissionStartedAt != nil && old.ProviderAssetID == "" {
				return applicationpackage.ErrReviewStateConflict
			}
		}
		result.Replaced = make([]applicationpackage.AssetReviewRecord, 0, len(oldRows))
		oldIDs := make([]persistenceid.UUID, 0, len(oldRows))
		cleanupRows := make([]assetReviewCleanupOutboxRow, 0, len(oldRows))
		for _, old := range oldRows {
			oldIDs = append(oldIDs, old.ID)
			if old.DeletedAt != 0 {
				continue
			}
			result.Replaced = append(result.Replaced, reviewRecordFromRow(old))
			if old.ReservationID == "" {
				continue
			}
			cleanupRows = append(cleanupRows, assetReviewCleanupOutboxRow{ReviewID: old.ID, AssetID: old.AssetID, PackageID: old.PackageID, TenantID: old.TenantID, WorkspaceID: old.WorkspaceID, ProviderAssetID: old.ProviderAssetID, ReservationID: old.ReservationID, Status: applicationpackage.ReviewCleanupStatusPending, NextAttemptAt: input.Now.UTC(), StateVersion: 1, CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC()})
		}
		if len(cleanupRows) > 0 {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&cleanupRows).Error; err != nil {
				return fmt.Errorf("enqueue replaced asset review cleanup: %w", err)
			}
		}
		if len(oldIDs) > 0 {
			if err := tx.Unscoped().Where("id IN ?", oldIDs).Delete(&assetReviewRow{}).Error; err != nil {
				return fmt.Errorf("delete replaced asset reviews: %w", err)
			}
		}
		if err := tx.Create(&row).Error; err != nil {
			return translateReviewWriteError(err)
		}
		return nil
	})
	if err != nil {
		return applicationpackage.ReplaceAssetReviewResult{}, err
	}
	return result, nil
}

func (r *Repository) SetAssetReviewReservation(ctx context.Context, reviewID, reservationID string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	result := persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id = ? AND status = ? AND reservation_id = ''", id, domainasset.ReviewStatusSubmitting).Updates(map[string]any{"reservation_id": reservationID, "updated_at": now.UTC()})
	return reviewUpdateResult(result)
}

func (r *Repository) MarkAssetReviewSubmissionStarted(ctx context.Context, reviewID, taskRunID string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return reviewUpdateResult(persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id = ? AND task_run_id = ? AND status = ? AND submission_started_at IS NULL", id, taskRunID, domainasset.ReviewStatusSubmitting).Updates(map[string]any{"submission_started_at": now.UTC(), "updated_at": now.UTC()}))
}

func (r *Repository) ResetAssetReviewSubmission(ctx context.Context, reviewID, taskRunID string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return reviewUpdateResult(persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id = ? AND task_run_id = ? AND status = ? AND submission_started_at IS NOT NULL", id, taskRunID, domainasset.ReviewStatusSubmitting).Updates(map[string]any{"submission_started_at": nil, "updated_at": now.UTC()}))
}

func (r *Repository) MarkAssetReviewProcessing(ctx context.Context, reviewID, taskRunID, providerAssetID string, submittedAt time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return reviewUpdateResult(persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id = ? AND task_run_id = ? AND status = ?", id, taskRunID, domainasset.ReviewStatusSubmitting).Updates(map[string]any{"provider_asset_id": providerAssetID, "status": domainasset.ReviewStatusProcessing, "submitted_at": submittedAt.UTC(), "updated_at": submittedAt.UTC()}))
}

func (r *Repository) MarkAssetReviewFailed(ctx context.Context, reviewID, reason string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return reviewUpdateResult(persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id = ? AND status = ?", id, domainasset.ReviewStatusSubmitting).Updates(map[string]any{"status": domainasset.ReviewStatusFailed, "failure_reason": reason, "updated_at": now.UTC()}))
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
	return reviewUpdateResult(persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id = ? AND status = ?", id, domainasset.ReviewStatusProcessing).Updates(map[string]any{"status": status, "failure_reason": reason, "updated_at": now.UTC()}))
}

func (r *Repository) RetireAssetReviews(ctx context.Context, scope applicationasset.Scope, assetID string, now time.Time) ([]applicationpackage.AssetReviewRecord, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return nil, nil
	}
	query := persistencetransaction.DB(ctx, r.db).Clauses(clause.Locking{Strength: "UPDATE"}).Where("tenant_id = ? AND asset_id = ?", scope.TenantID, id)
	if scope.WorkspaceID == nil {
		query = query.Where("workspace_id IS NULL")
	} else {
		query = query.Where("workspace_id = ?", *scope.WorkspaceID)
	}
	var rows []assetReviewRow
	if err = query.Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("find asset reviews for retirement: %w", err)
	}
	ids := make([]persistenceid.UUID, 0, len(rows))
	records := make([]applicationpackage.AssetReviewRecord, 0, len(rows))
	outbox := make([]assetReviewCleanupOutboxRow, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		records = append(records, reviewRecordFromRow(row))
		if row.ReservationID != "" {
			outbox = append(outbox, assetReviewCleanupOutboxRow{ReviewID: row.ID, AssetID: row.AssetID, PackageID: row.PackageID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, ProviderAssetID: row.ProviderAssetID, ReservationID: row.ReservationID, Status: applicationpackage.ReviewCleanupStatusPending, NextAttemptAt: now.UTC(), StateVersion: 1, CreatedAt: now.UTC(), UpdatedAt: now.UTC()})
		}
	}
	if len(outbox) > 0 {
		if err = persistencetransaction.DB(ctx, r.db).Clauses(clause.OnConflict{DoNothing: true}).Create(&outbox).Error; err != nil {
			return nil, fmt.Errorf("enqueue asset review cleanup: %w", err)
		}
	}
	if len(ids) > 0 {
		err = persistencetransaction.DB(ctx, r.db).Model(&assetReviewRow{}).Where("id IN ?", ids).Updates(map[string]any{"deleted_at": soft_delete.DeletedAt(now.UnixMilli()), "updated_at": now.UTC()}).Error
	}
	return records, err
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
	query := persistencetransaction.DB(ctx, r.db).Where("tenant_id = ? AND asset_id IN ?", tenantID, ids)
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
	for _, row := range rows {
		review := domainasset.Review{PackageID: row.PackageID, PackageName: row.PackageName, ModelIDs: append([]string{}, row.ModelIDs...), SystemPresetModels: row.SystemPresetModels, ProviderAssetID: row.ProviderAssetID, Status: domainasset.ReviewStatus(row.Status), FailureReason: row.FailureReason, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
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
	assetID, err := persistenceid.Parse(input.AssetID)
	if err != nil {
		return assetReviewRow{}, err
	}
	return assetReviewRow{ID: id, TaskRunID: taskRunID, TenantID: input.TenantID, WorkspaceID: input.WorkspaceID, ProjectID: projectID, PackageID: input.PackageID, PackageName: input.PackageName, ModelIDs: input.ModelIDs, SystemPresetModels: input.SystemPresetModels, AssetID: assetID, Status: string(domainasset.ReviewStatusSubmitting), CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC()}, nil
}

func reviewRecordFromRow(row assetReviewRow) applicationpackage.AssetReviewRecord {
	return applicationpackage.AssetReviewRecord{ID: row.ID.String(), TaskRunID: row.TaskRunID.String(), TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID.String(), PackageID: row.PackageID, PackageName: row.PackageName, AssetID: row.AssetID.String(), ProviderAssetID: row.ProviderAssetID, ReservationID: row.ReservationID, ModelIDs: append([]string{}, row.ModelIDs...), SystemPresetModels: row.SystemPresetModels, SubmissionStartedAt: row.SubmissionStartedAt, Status: domainasset.ReviewStatus(row.Status), FailureReason: row.FailureReason, SubmittedAt: row.SubmittedAt, CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC()}
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
	if strings.Contains(message, "uniq_asset_reviews_scope_asset_package") {
		return applicationpackage.ErrReviewStateConflict
	}
	return fmt.Errorf("persist asset review: %w", err)
}
