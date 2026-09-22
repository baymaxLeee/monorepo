package asset

import (
	"context"
	"errors"
	"time"
)

const (
	garbageCollectionBatchSize = 100
	garbageCollectionLease     = 2 * time.Minute
)

type GarbageCollectionAsset struct {
	AssetID           string
	TenantID          string
	WorkspaceID       *string
	ArtifactID        string
	ArtifactNamespace string
}

type GarbageCollectionCandidate struct {
	GarbageCollectionAsset
	DeletedAt      time.Time
	PurgeNotBefore time.Time
	NextAttemptAt  time.Time
	LeaseUntil     *time.Time
	StateVersion   int64
	Attempts       int32
	LastError      string
	CreatedAt      time.Time
}

type GarbageCollectionRepository interface {
	FindZeroReferenceAssets(context.Context, time.Time, string, int) ([]GarbageCollectionAsset, error)
	SoftDeleteForGarbageCollection(context.Context, GarbageCollectionAsset, time.Time, time.Time) (bool, error)
	ClaimGarbageCollection(context.Context, time.Time, time.Time, int) ([]GarbageCollectionCandidate, error)
	ArtifactHasOtherAssets(context.Context, GarbageCollectionCandidate) (bool, error)
	CompleteGarbageCollection(context.Context, GarbageCollectionCandidate) (bool, error)
	RescheduleGarbageCollection(context.Context, GarbageCollectionCandidate, time.Time, string, time.Time) (bool, error)
}

type ReferenceCounter interface {
	CountReferences(context.Context, ReferenceScope, []string) (map[string]int32, error)
}

type ArtifactDeleter interface {
	Delete(context.Context, string, string) error
}

type GarbageCollectionStorageQuota interface {
	MarkStorageReleasing(context.Context, string, string) (bool, error)
	ReleaseStorage(context.Context, string, string) (bool, error)
}

type GarbageCollector struct {
	repository GarbageCollectionRepository
	references ReferenceCounter
	artifacts  ArtifactDeleter
	clock      Clock
	minimumAge time.Duration
	retention  time.Duration
	reviews    ReviewCleanupPreparer
	failures   ReviewCleanupFailureReporter
	storage    GarbageCollectionStorageQuota
}

func WithGarbageCollectionStorageQuota(storage GarbageCollectionStorageQuota) GarbageCollectorOption {
	return func(collector *GarbageCollector) { collector.storage = storage }
}

type GarbageCollectorOption func(*GarbageCollector)

func WithGarbageCollectionReviewCleanup(cleaner ReviewCleanupPreparer, reporter ReviewCleanupFailureReporter) GarbageCollectorOption {
	return func(collector *GarbageCollector) {
		collector.reviews = cleaner
		collector.failures = reporter
	}
}

func NewGarbageCollector(
	repository GarbageCollectionRepository,
	references ReferenceCounter,
	artifacts ArtifactDeleter,
	clock Clock,
	minimumAge time.Duration,
	retention time.Duration,
	options ...GarbageCollectorOption,
) *GarbageCollector {
	collector := &GarbageCollector{repository: repository, references: references, artifacts: artifacts, clock: clock, minimumAge: minimumAge, retention: retention}
	for _, option := range options {
		option(collector)
	}
	return collector
}

func (collector *GarbageCollector) Run(ctx context.Context, budget time.Duration) (int, error) {
	deadline := collector.clock.Now().Add(budget)
	var failures error
	if err := collector.softDeleteUnreferenced(ctx, deadline); err != nil {
		failures = errors.Join(failures, err)
	}
	completed := 0
	for collector.clock.Now().Before(deadline) && ctx.Err() == nil {
		batchCompleted, claimed, err := collector.purgeBatch(ctx)
		completed += batchCompleted
		failures = errors.Join(failures, err)
		if claimed == 0 {
			break
		}
	}
	return completed, failures
}

func (collector *GarbageCollector) softDeleteUnreferenced(ctx context.Context, deadline time.Time) error {
	afterAssetID := ""
	var failures error
	for collector.clock.Now().Before(deadline) && ctx.Err() == nil {
		items, err := collector.repository.FindZeroReferenceAssets(ctx, collector.clock.Now().Add(-collector.minimumAge), afterAssetID, garbageCollectionBatchSize)
		if err != nil {
			return errors.Join(failures, err)
		}
		for _, item := range items {
			afterAssetID = item.AssetID
			blocked, referenceErr := collector.hasBlockingReferences(ctx, item)
			if referenceErr != nil {
				failures = errors.Join(failures, referenceErr)
				continue
			}
			if blocked {
				continue
			}
			now := collector.clock.Now()
			changed, deleteErr := collector.repository.SoftDeleteForGarbageCollection(ctx, item, now, now.Add(collector.retention))
			failures = errors.Join(failures, deleteErr)
			if deleteErr == nil && changed {
				if prepareErr := collector.prepareReviewCleanup(ctx, item); prepareErr != nil {
					continue
				}
			}
		}
		if len(items) < garbageCollectionBatchSize {
			break
		}
	}
	return failures
}

func (collector *GarbageCollector) prepareReviewCleanup(ctx context.Context, item GarbageCollectionAsset) error {
	if collector.reviews == nil {
		return nil
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, reviewCleanupTimeout)
	defer cancel()
	err := collector.reviews.PrepareAssetReviewCleanup(cleanupCtx, item)
	if err != nil && collector.failures != nil {
		collector.failures.ReportReviewCleanupFailure(cleanupCtx, item, err)
	}
	return err
}

func (collector *GarbageCollector) purgeBatch(ctx context.Context) (int, int, error) {
	now := collector.clock.Now()
	items, err := collector.repository.ClaimGarbageCollection(ctx, now, now.Add(garbageCollectionLease), garbageCollectionBatchSize)
	if err != nil {
		return 0, 0, err
	}
	completed := 0
	var failures error
	for _, item := range items {
		if prepareErr := collector.prepareReviewCleanup(ctx, item.GarbageCollectionAsset); prepareErr != nil {
			failures = errors.Join(failures, prepareErr, collector.reschedule(ctx, item, "review cleanup outbox preparation failed", now))
			continue
		}
		blocked, referenceErr := collector.hasBlockingReferences(ctx, item.GarbageCollectionAsset)
		if referenceErr != nil {
			failures = errors.Join(failures, referenceErr, collector.reschedule(ctx, item, "reference ledger unavailable", now))
			continue
		}
		if blocked {
			failures = errors.Join(failures, collector.reschedule(ctx, item, "asset references remain", now))
			continue
		}
		hasOther, otherErr := collector.repository.ArtifactHasOtherAssets(ctx, item)
		if otherErr != nil {
			failures = errors.Join(failures, otherErr, collector.reschedule(ctx, item, "artifact ownership check failed", now))
			continue
		}
		if !hasOther {
			if collector.storage != nil {
				if _, markErr := collector.storage.MarkStorageReleasing(ctx, "artifact", item.ArtifactID); markErr != nil {
					failures = errors.Join(failures, markErr, collector.reschedule(ctx, item, "storage release preparation failed", now))
					continue
				}
			}
			// Delete external storage before metadata. A crash between the two steps
			// converges because the Artifact adapter treats an already-missing object as success.
			if deleteErr := collector.artifacts.Delete(ctx, item.ArtifactID, item.ArtifactNamespace); deleteErr != nil {
				failures = errors.Join(failures, deleteErr, collector.reschedule(ctx, item, "artifact deletion failed", now))
				continue
			}
			if collector.storage != nil {
				if _, releaseErr := collector.storage.ReleaseStorage(ctx, "artifact", item.ArtifactID); releaseErr != nil {
					failures = errors.Join(failures, releaseErr, collector.reschedule(ctx, item, "storage release failed", now))
					continue
				}
			}
		}
		ok, completeErr := collector.repository.CompleteGarbageCollection(ctx, item)
		failures = errors.Join(failures, completeErr)
		if ok {
			completed++
		}
	}
	return completed, len(items), failures
}

func (collector *GarbageCollector) hasBlockingReferences(ctx context.Context, item GarbageCollectionAsset) (bool, error) {
	counts, err := collector.references.CountReferences(ctx, ReferenceScope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}, []string{item.AssetID})
	if err != nil {
		return true, err
	}
	return counts[item.AssetID] > 0, nil
}

func (collector *GarbageCollector) reschedule(ctx context.Context, item GarbageCollectionCandidate, message string, now time.Time) error {
	_, err := collector.repository.RescheduleGarbageCollection(ctx, item, now.Add(garbageCollectionRetryDelay(item.Attempts+1)), message, now)
	return err
}

func garbageCollectionRetryDelay(attempt int32) time.Duration {
	delay := time.Minute
	for current := int32(1); current < attempt && delay < time.Hour; current++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}
