package benefitpackage

import (
	"context"
	"errors"
	"time"
)

const (
	reviewCleanupBatchSize = 100
	reviewCleanupLease     = 2 * time.Minute
)

type ReviewCleanupProcessor struct {
	repository   ReviewCleanupOutboxRepository
	gateway      ReviewGateway
	transactions TransactionManager
	clock        Clock
	maxAttempts  int
}

type ReviewCleanupResult struct {
	Claimed, Completed, Failed int
	Failures                   []ReviewCleanupFailure
	RoundError                 error
}

type ReviewCleanupFailure struct {
	ReviewID, AssetID, ProviderAssetID string
	Attempt                            int32
	Err                                error
}

func NewReviewCleanupProcessor(repository ReviewCleanupOutboxRepository, gateway ReviewGateway, transactions TransactionManager, clock Clock, maxAttempts int) *ReviewCleanupProcessor {
	return &ReviewCleanupProcessor{repository: repository, gateway: gateway, transactions: transactions, clock: clock, maxAttempts: maxAttempts}
}

func (processor *ReviewCleanupProcessor) ProcessDue(ctx context.Context, budget time.Duration) ReviewCleanupResult {
	deadline := processor.clock.Now().Add(budget)
	var result ReviewCleanupResult
	for processor.clock.Now().Before(deadline) && ctx.Err() == nil {
		batch := processor.processBatch(ctx)
		result.Claimed += batch.Claimed
		result.Completed += batch.Completed
		result.Failed += batch.Failed
		result.Failures = append(result.Failures, batch.Failures...)
		result.RoundError = errors.Join(result.RoundError, batch.RoundError)
		if batch.Claimed == 0 || batch.RoundError != nil {
			break
		}
	}
	return result
}

func (processor *ReviewCleanupProcessor) processBatch(ctx context.Context) ReviewCleanupResult {
	now := processor.clock.Now()
	items, err := processor.repository.ClaimReviewCleanup(ctx, now, now.Add(reviewCleanupLease), reviewCleanupBatchSize)
	if err != nil {
		return ReviewCleanupResult{RoundError: err}
	}
	result := ReviewCleanupResult{Claimed: len(items), Failures: make([]ReviewCleanupFailure, 0)}
	for _, item := range items {
		if err = processor.cleanup(ctx, item); err != nil {
			if int(item.Attempts)+1 >= processor.maxAttempts {
				marked, markErr := processor.repository.MarkReviewCleanupDead(ctx, item, "asset review cleanup reached maximum attempts", now)
				if markErr == nil && !marked {
					markErr = errors.New("mark asset review cleanup dead rejected")
				}
				result.addFailure(item, errors.Join(err, markErr))
				continue
			}
			_, retryErr := processor.repository.RescheduleReviewCleanup(ctx, item, now.Add(reviewCleanupRetryDelay(item.Attempts+1)), "Admin review cleanup failed", now)
			result.addFailure(item, errors.Join(err, retryErr))
			continue
		}
		if err = processor.complete(ctx, item, now); err != nil {
			_, retryErr := processor.repository.RescheduleReviewCleanup(ctx, item, now.Add(reviewCleanupRetryDelay(item.Attempts+1)), "review cleanup completion failed", now)
			result.addFailure(item, errors.Join(err, retryErr))
			continue
		}
		result.Completed++
	}
	return result
}

func (processor *ReviewCleanupProcessor) cleanup(ctx context.Context, item ReviewCleanupOutbox) error {
	workspace := workspaceID(item.WorkspaceID)
	if _, err := processor.gateway.BeginBenefitPackageReviewCleanup(ctx, item.TenantID, workspace, item.PackageID, item.ReservationID, item.ReviewID); err != nil {
		return err
	}
	if item.ProviderAssetID != "" {
		if err := processor.gateway.DeleteReviewedAsset(ctx, item.TenantID, workspace, item.PackageID, item.ProviderAssetID); err != nil {
			return err
		}
	}
	_, err := processor.gateway.CompleteBenefitPackageReviewCleanup(ctx, item.TenantID, workspace, item.PackageID, item.ReservationID, item.ReviewID)
	return err
}

func (processor *ReviewCleanupProcessor) complete(ctx context.Context, item ReviewCleanupOutbox, now time.Time) error {
	return processor.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		ok, err := processor.repository.CompleteReviewCleanup(tx, item, now)
		if err != nil {
			return err
		}
		if !ok {
			return errors.New("complete asset review cleanup lease lost")
		}
		return nil
	})
}

func (result *ReviewCleanupResult) addFailure(item ReviewCleanupOutbox, err error) {
	result.Failed++
	result.Failures = append(result.Failures, ReviewCleanupFailure{ReviewID: item.ReviewID, AssetID: item.AssetID, ProviderAssetID: item.ProviderAssetID, Attempt: item.Attempts + 1, Err: err})
}

func reviewCleanupRetryDelay(attempt int32) time.Duration {
	delay := time.Minute
	for current := int32(1); current < attempt && delay < time.Hour; current++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}
