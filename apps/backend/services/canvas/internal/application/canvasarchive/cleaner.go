package canvasarchive

import (
	"context"
	"errors"
	"time"

	applicationquota "github.com/example/monorepo/canvas/internal/application/quota"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
)

const (
	cleanupClaimLimit = 20
	cleanupLease      = 2 * time.Minute
)

type CleanupRepository interface {
	ClaimCleanupDue(context.Context, time.Time, time.Time, int) ([]Export, error)
	CompleteCleanup(context.Context, Export, time.Time) (bool, error)
	RescheduleCleanup(context.Context, Export, time.Time, string, time.Time) (bool, error)
}

type AssociationStore interface {
	Delete(context.Context, string, string) error
}

type Cleaner struct {
	repository CleanupRepository
	store      AssociationStore
	quota      CleanupStorageQuota
	clock      Clock
}

func NewCleaner(repository CleanupRepository, store AssociationStore, quota CleanupStorageQuota, clock Clock) *Cleaner {
	return &Cleaner{repository: repository, store: store, quota: quota, clock: clock}
}

func (cleaner *Cleaner) CleanupDue(ctx context.Context, budget time.Duration) (int, error) {
	deadline := cleaner.clock.Now().Add(budget)
	completed := 0
	var failures error
	for cleaner.clock.Now().Before(deadline) {
		batchCompleted, claimed, err := cleaner.cleanupDueBatch(ctx)
		completed += batchCompleted
		failures = errors.Join(failures, err)
		if claimed == 0 {
			break
		}
	}
	return completed, failures
}

func (cleaner *Cleaner) cleanupDueBatch(ctx context.Context) (int, int, error) {
	now := cleaner.clock.Now()
	items, err := cleaner.repository.ClaimCleanupDue(ctx, now, now.Add(cleanupLease), cleanupClaimLimit)
	if err != nil {
		return 0, 0, err
	}
	completed := 0
	var failures error
	for index := range items {
		item := items[index]
		workCtx := logcontext.WithBusiness(ctx, logcontext.Business{TaskRunID: item.TaskRunID})
		if cleaner.quota != nil {
			if _, markErr := cleaner.quota.MarkStorageReleasing(
				workCtx, "archive_path", item.OutputPath,
			); markErr != nil {
				failures = errors.Join(
					failures,
					cleaner.reschedule(workCtx, item, now, markErr),
				)
				continue
			}
		}
		if deleteErr := cleaner.store.Delete(workCtx, item.OutputSHA256, item.TaskRunID); deleteErr != nil {
			failures = errors.Join(
				failures,
				cleaner.reschedule(workCtx, item, now, deleteErr),
			)
			continue
		}
		if cleaner.quota != nil {
			released, releaseErr := cleaner.quota.ReleaseStorage(workCtx, "archive_path", item.OutputPath)
			if releaseErr == nil && !released {
				releaseErr = cleaner.quota.ReleaseReservation(
					workCtx,
					applicationquota.Reservation{
						ID:       applicationquota.StorageReservationID("archive_path", item.OutputPath),
						TenantID: item.TenantID, Resource: applicationquota.ResourceStorage,
						Value: item.OutputSize,
					},
				)
			}
			if releaseErr != nil {
				failures = errors.Join(
					failures,
					cleaner.reschedule(workCtx, item, now, releaseErr),
				)
				continue
			}
		}
		ok, completeErr := cleaner.repository.CompleteCleanup(workCtx, item, now)
		if completeErr != nil {
			failures = errors.Join(failures, completeErr)
			continue
		}
		if ok {
			completed++
		}
	}
	return completed, len(items), failures
}

func (cleaner *Cleaner) reschedule(ctx context.Context, item Export, now time.Time, cause error) error {
	next := now.Add(cleanupRetryDelay(item.CleanupAttempts + 1))
	_, err := cleaner.repository.RescheduleCleanup(
		ctx, item, next, "archive association release failed", now,
	)
	return errors.Join(cause, err)
}

func cleanupRetryDelay(attempt int32) time.Duration {
	delay := time.Minute
	for current := int32(1); current < attempt && delay < time.Hour; current++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}
