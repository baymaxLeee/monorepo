package benefitpackage

import (
	"context"
	"errors"
	"fmt"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domainpackage "github.com/example/monorepo/canvas/internal/domain/benefitpackage"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type ReviewCleanupService struct {
	reviews      AssetReviewCleanupRepository
	tasks        ReviewCleanupTaskStore
	transactions TransactionManager
	clock        Clock
	quota        ReviewQuota
}

func NewReviewCleanupService(reviews AssetReviewCleanupRepository, tasks ReviewCleanupTaskStore, transactions TransactionManager, clock Clock, quota ReviewQuota) *ReviewCleanupService {
	return &ReviewCleanupService{
		reviews: reviews, tasks: tasks, transactions: transactions, clock: clock, quota: quota,
	}
}

func (service *ReviewCleanupService) PrepareAssetReviewCleanup(ctx context.Context, item applicationasset.GarbageCollectionAsset) error {
	now := service.clock.Now()
	return service.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		records, retireErr := service.reviews.RetireAssetReviews(tx, applicationasset.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}, item.AssetID, now)
		if retireErr != nil {
			return retireErr
		}
		return service.cancelReviewTasks(tx, records, now)
	})
}

func (service *ReviewCleanupService) DeletePackage(
	ctx context.Context,
	item domainpackage.Package,
	expectedRevision int64,
	deleteExternalReviewedAssets bool,
) error {
	now := service.clock.Now()
	return service.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		records, err := service.reviews.Delete(tx, item, expectedRevision, deleteExternalReviewedAssets)
		if err != nil {
			return err
		}
		if err = service.cancelReviewTasks(tx, records, now); err != nil {
			return err
		}
		return nil
	})
}

func (service *ReviewCleanupService) cancelReviewTasks(ctx context.Context, records []AssetReviewRecord, now time.Time) error {
	return cancelReviewTasks(ctx, records, service.tasks, service.quota, now)
}

func cancelReviewTasks(ctx context.Context, records []AssetReviewRecord, tasks ReviewCleanupTaskStore, quota ReviewQuota, now time.Time) error {
	for _, record := range records {
		if record.QuotaReservationID != "" && quota != nil {
			if record.ProviderAssetID != "" {
				if quotaErr := quota.BeginPresetEntitlementRelease(
					ctx, record.QuotaReservationID,
				); quotaErr != nil {
					return quotaErr
				}
			} else if quotaErr := quota.ReleaseReservation(ctx, applicationquota.Reservation{
				ID: record.QuotaReservationID,
			}); quotaErr != nil {
				return quotaErr
			}
		}
		run, getErr := tasks.GetTaskRunForUpdate(ctx, record.TaskRunID)
		if errors.Is(getErr, applicationtask.ErrNotFound) {
			continue
		}
		if getErr != nil {
			return getErr
		}
		if run.Terminal() {
			continue
		}
		won, updateErr := tasks.UpdateTaskRun(ctx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &now}, now)
		if updateErr != nil {
			return updateErr
		}
		if !won {
			return fmt.Errorf("asset review task run %s lost its update fence", run.ID)
		}
		if deleteErr := tasks.DeletePollSchedule(ctx, run.ID); deleteErr != nil {
			return deleteErr
		}
	}
	return nil
}
