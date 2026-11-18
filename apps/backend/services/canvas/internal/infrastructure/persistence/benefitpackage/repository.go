package benefitpackage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func reviewRowFromReserve(input applicationpackage.ReserveAssetReviewInput) (sqlc.InsertAssetReviewParams, error) {
	id, err := persistenceid.Parse(input.ID)
	if err != nil {
		return sqlc.InsertAssetReviewParams{}, err
	}
	taskRunID, err := persistenceid.Parse(input.TaskRunID)
	if err != nil {
		return sqlc.InsertAssetReviewParams{}, err
	}
	projectID, err := persistenceid.Parse(input.ProjectID)
	if err != nil {
		return sqlc.InsertAssetReviewParams{}, err
	}
	assetID, err := persistenceid.Parse(input.AssetID)
	if err != nil {
		return sqlc.InsertAssetReviewParams{}, err
	}
	modelIDs, err := json.Marshal(input.ModelIDs)
	if err != nil {
		return sqlc.InsertAssetReviewParams{}, err
	}
	return sqlc.InsertAssetReviewParams{
		ID:                 id.String(),
		TaskRunID:          taskRunID.String(),
		TenantID:           input.TenantID,
		WorkspaceID:        input.WorkspaceID,
		ProjectID:          projectID.String(),
		PackageID:          input.PackageID,
		PackageName:        input.PackageName,
		ModelIds:           string(modelIDs),
		SystemPresetModels: input.SystemPresetModels,
		AssetID:            assetID.String(),
		Status:             string(domainasset.ReviewStatusSubmitting),
		CreatedAt:          input.Now.UTC(),
		UpdatedAt:          input.Now.UTC(),
	}, nil
}

func reviewRecordFromRow(row sqlc.AssetReview) (applicationpackage.AssetReviewRecord, error) {
	var modelIDs []string
	if err := json.Unmarshal([]byte(row.ModelIds), &modelIDs); err != nil {
		return applicationpackage.AssetReviewRecord{}, err
	}
	return applicationpackage.AssetReviewRecord{
		ID:                  row.ID,
		TaskRunID:           row.TaskRunID,
		TenantID:            row.TenantID,
		WorkspaceID:         &row.WorkspaceID,
		ProjectID:           row.ProjectID,
		PackageID:           row.PackageID,
		PackageName:         row.PackageName,
		AssetID:             row.AssetID,
		ProviderAssetID:     row.ProviderAssetID,
		ReservationID:       row.ReservationID,
		ModelIDs:            append([]string{}, modelIDs...),
		SystemPresetModels:  row.SystemPresetModels,
		SubmissionStartedAt: row.SubmissionStartedAt,
		Status:              domainasset.ReviewStatus(row.Status),
		FailureReason:       row.FailureReason,
		SubmittedAt:         row.SubmittedAt,
		CreatedAt:           row.CreatedAt.UTC(),
		UpdatedAt:           row.UpdatedAt.UTC(),
	}, nil
}

func (r *Repository) enqueueCleanup(ctx context.Context, row sqlc.AssetReview, now time.Time) error {
	if row.ReservationID == "" {
		return nil
	}
	return r.db.Queries(ctx).EnqueueReviewCleanup(ctx, sqlc.EnqueueReviewCleanupParams{
		ReviewID:        row.ID,
		AssetID:         row.AssetID,
		PackageID:       row.PackageID,
		TenantID:        row.TenantID,
		WorkspaceID:     row.WorkspaceID,
		ProviderAssetID: row.ProviderAssetID,
		ReservationID:   row.ReservationID,
		Status:          applicationpackage.ReviewCleanupStatusPending,
		NextAttemptAt:   now.UTC(),
		LeaseUntil:      nil,
		StateVersion:    1,
		Attempts:        0,
		LastError:       "",
		CreatedAt:       now.UTC(),
		UpdatedAt:       now.UTC(),
	})
}

func (r *Repository) ReplaceAssetReview(ctx context.Context, input applicationpackage.ReserveAssetReviewInput) (applicationpackage.ReplaceAssetReviewResult, error) {
	row, err := reviewRowFromReserve(input)
	if err != nil {
		return applicationpackage.ReplaceAssetReviewResult{}, err
	}
	var result applicationpackage.ReplaceAssetReviewResult
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		oldRows, err := r.db.Queries(ctx).LockReviewsForReplacement(ctx, sqlc.LockReviewsForReplacementParams{
			TenantID:    row.TenantID,
			WorkspaceID: row.WorkspaceID,
			AssetID:     row.AssetID,
			PackageID:   row.PackageID,
		})
		if err != nil {
			return err
		}
		ids := make([]string, 0, len(oldRows))
		result.Replaced = make([]applicationpackage.AssetReviewRecord, 0, len(oldRows))
		for _, old := range oldRows {
			ids = append(ids, old.ID)
			if old.DeletedAt != 0 {
				continue
			}
			if domainasset.ReviewStatus(old.Status) == domainasset.ReviewStatusSubmitting && old.SubmissionStartedAt != nil && old.ProviderAssetID == "" {
				return applicationpackage.ErrReviewStateConflict
			}
			rec, err := reviewRecordFromRow(old)
			if err != nil {
				return err
			}
			result.Replaced = append(result.Replaced, rec)
			if err := r.enqueueCleanup(ctx, old, input.Now); err != nil {
				return err
			}
		}
		q := r.db.Queries(ctx)
		if err := q.RemoveReplacedReviews(ctx, ids); err != nil {
			return err
		}
		if err := q.InsertAssetReview(ctx, row); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uniq_asset_reviews_scope_asset_package" {
				return applicationpackage.ErrReviewStateConflict
			}
			return err
		}
		current, err := q.ReadTaskAssetReview(ctx, row.TaskRunID)
		if err != nil {
			return err
		}
		result.Current, err = reviewRecordFromRow(current)
		return err
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
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ReserveReview(ctx, sqlc.ReserveReviewParams{
			ReservationID: reservationID,
			UpdatedAt:     now.UTC(),
			ID:            id.String(),
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationpackage.ErrReviewStateConflict
		}
		return nil
	})
}

func (r *Repository) MarkAssetReviewSubmissionStarted(ctx context.Context, reviewID, taskRunID string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).StartReviewSubmission(ctx, sqlc.StartReviewSubmissionParams{
			UpdatedAt: now.UTC(),
			ID:        id.String(),
			TaskRunID: taskRunID,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationpackage.ErrReviewStateConflict
		}
		return nil
	})
}

func (r *Repository) ResetAssetReviewSubmission(ctx context.Context, reviewID, taskRunID, reason string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ResetReviewSubmission(ctx, sqlc.ResetReviewSubmissionParams{
			UpdatedAt:     now.UTC(),
			FailureReason: reason,
			ID:            id.String(),
			TaskRunID:     taskRunID,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationpackage.ErrReviewStateConflict
		}
		return nil
	})
}

func (r *Repository) MarkAssetReviewProcessing(ctx context.Context, reviewID, taskRunID, providerAssetID string, submittedAt time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).ProcessReview(ctx, sqlc.ProcessReviewParams{
			UpdatedAt:       submittedAt.UTC(),
			ProviderAssetID: providerAssetID,
			ID:              id.String(),
			TaskRunID:       taskRunID,
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationpackage.ErrReviewStateConflict
		}
		return nil
	})
}

func (r *Repository) MarkAssetReviewFailed(ctx context.Context, reviewID, reason string, now time.Time) error {
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).FailReview(ctx, sqlc.FailReviewParams{
			FailureReason: reason,
			UpdatedAt:     now.UTC(),
			ID:            id.String(),
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationpackage.ErrReviewStateConflict
		}
		return nil
	})
}

func (r *Repository) MarkAssetReviewTerminal(ctx context.Context, reviewID string, status domainasset.ReviewStatus, reason string, now time.Time) error {
	if status != domainasset.ReviewStatusApproved && status != domainasset.ReviewStatusFailed {
		return fmt.Errorf("unsupported terminal asset review status %q", status)
	}
	id, err := persistenceid.Parse(reviewID)
	if err != nil {
		return applicationpackage.ErrReviewNotFound
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		n, err := r.db.Queries(ctx).FinishReview(ctx, sqlc.FinishReviewParams{
			Status:        string(status),
			FailureReason: reason,
			UpdatedAt:     now.UTC(),
			ID:            id.String(),
		})
		if err != nil {
			return err
		}
		if n != 1 {
			return applicationpackage.ErrReviewStateConflict
		}
		return nil
	})
}

func (r *Repository) GetAssetReviewByTaskRun(ctx context.Context, taskRunID string) (applicationpackage.AssetReviewRecord, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return applicationpackage.AssetReviewRecord{}, applicationpackage.ErrReviewNotFound
	}
	row, err := r.db.Queries(ctx).ReadTaskAssetReview(ctx, id.String())
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationpackage.AssetReviewRecord{}, applicationpackage.ErrReviewNotFound
	}
	if err != nil {
		return applicationpackage.AssetReviewRecord{}, err
	}
	return reviewRecordFromRow(row)
}

func (r *Repository) RetireAssetReviews(ctx context.Context, scope applicationasset.Scope, assetID string, now time.Time) ([]applicationpackage.AssetReviewRecord, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return nil, nil
	}
	var records []applicationpackage.AssetReviewRecord
	err = r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		rows, err := r.db.Queries(ctx).LockRetiringReviews(ctx, sqlc.LockRetiringReviewsParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			AssetID:     id.String(),
		})
		if err != nil {
			return err
		}
		ids := make([]string, 0, len(rows))
		records = make([]applicationpackage.AssetReviewRecord, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
			rec, err := reviewRecordFromRow(row)
			if err != nil {
				return err
			}
			records = append(records, rec)
			if err := r.enqueueCleanup(ctx, row, now); err != nil {
				return err
			}
		}
		return r.db.Queries(ctx).RetireReviews(ctx, sqlc.RetireReviewsParams{
			RetiredAt: now.UnixMilli(),
			UpdatedAt: now.UTC(),
			Ids:       ids,
		})
	})
	if err != nil {
		return nil, err
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
	ids := persistenceid.ParseValidStrings(assetIDs)
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := r.db.Queries(ctx).ReadAssetReviews(ctx, sqlc.ReadAssetReviewsParams{
		TenantID:    tenantID,
		WorkspaceID: workspaceID,
		Ids:         ids,
		ProjectID:   persistenceid.OptionalText(projectID),
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		var modelIDs []string
		if err := json.Unmarshal([]byte(row.ModelIds), &modelIDs); err != nil {
			return nil, err
		}
		review := domainasset.Review{
			PackageID:          row.PackageID,
			PackageName:        row.PackageName,
			ModelIDs:           append([]string{}, modelIDs...),
			SystemPresetModels: row.SystemPresetModels,
			ProviderAssetID:    row.ProviderAssetID,
			Status:             domainasset.ReviewStatus(row.Status),
			FailureReason:      row.FailureReason,
			CreatedAt:          row.CreatedAt.UTC(),
			UpdatedAt:          row.UpdatedAt.UTC(),
		}
		if row.SubmittedAt != nil {
			review.SubmittedAt = row.SubmittedAt.UTC()
		}
		assetID := row.AssetID
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
