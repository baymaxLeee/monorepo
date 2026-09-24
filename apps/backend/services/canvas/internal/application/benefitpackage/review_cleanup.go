package benefitpackage

import (
	"context"
	"errors"
	"fmt"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type ReviewCleanupService struct {
	reviews      AssetReviewCleanupRepository
	tasks        ReviewCleanupTaskStore
	transactions TransactionManager
	clock        Clock
}

func NewReviewCleanupService(reviews AssetReviewCleanupRepository, tasks ReviewCleanupTaskStore, transactions TransactionManager, clock Clock) *ReviewCleanupService {
	return &ReviewCleanupService{reviews: reviews, tasks: tasks, transactions: transactions, clock: clock}
}

func (service *ReviewCleanupService) PrepareAssetReviewCleanup(ctx context.Context, item applicationasset.RetiredAsset) error {
	now := service.clock.Now()
	return service.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		records, err := service.reviews.RetireAssetReviews(tx, applicationasset.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}, item.AssetID, now)
		if err != nil {
			return err
		}
		return cancelReviewTasks(tx, records, service.tasks, now)
	})
}

func cancelReviewTasks(ctx context.Context, records []AssetReviewRecord, tasks ReviewCleanupTaskStore, now time.Time) error {
	for _, record := range records {
		run, err := tasks.GetTaskRunForUpdate(ctx, record.TaskRunID)
		if errors.Is(err, applicationtask.ErrNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		if run.Terminal() {
			continue
		}
		won, err := tasks.UpdateTaskRun(ctx, run, applicationtask.TaskRunUpdate{Status: domaintask.StatusCancelled, FinishedAt: &now}, now)
		if err != nil {
			return err
		}
		if !won {
			return fmt.Errorf("asset review task run %s lost its update fence", run.ID)
		}
		if err = tasks.DeletePollSchedule(ctx, run.ID); err != nil {
			return err
		}
	}
	return nil
}
