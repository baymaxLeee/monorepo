package benefitpackage

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const (
	reviewCleanupBatchSize = 100
	reviewCleanupLease     = 2 * time.Minute
)

type ReviewCleanupProcessor struct {
	repository   ReviewCleanupOutboxRepository
	provider     AssetReviewGateway
	cipher       CredentialCipher
	transactions TransactionManager
	quota        ReviewQuota
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

func NewReviewCleanupProcessor(repository ReviewCleanupOutboxRepository, provider AssetReviewGateway, cipher CredentialCipher, transactions TransactionManager, quota ReviewQuota, clock Clock, maxAttempts int) *ReviewCleanupProcessor {
	return &ReviewCleanupProcessor{
		repository: repository, provider: provider, cipher: cipher,
		transactions: transactions, quota: quota, clock: clock, maxAttempts: maxAttempts,
	}
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
		if deleteErr := processor.deleteReviewedAsset(ctx, item); deleteErr != nil {
			if errors.Is(deleteErr, ErrAssetReviewAuthorization) || int(item.Attempts)+1 >= processor.maxAttempts {
				message := "asset review cleanup reached maximum attempts"
				if errors.Is(deleteErr, ErrAssetReviewAuthorization) {
					message = "asset review cleanup authorization failed"
				}
				marked, markErr := processor.repository.MarkReviewCleanupDead(ctx, item, message, now)
				if markErr == nil && !marked {
					markErr = errors.New("mark asset review cleanup dead rejected")
				}
				result.addFailure(item, errors.Join(deleteErr, markErr))
				continue
			}
			_, rescheduleErr := processor.repository.RescheduleReviewCleanup(
				ctx, item, now.Add(reviewCleanupRetryDelay(item.Attempts+1)), "Ark reviewed asset deletion failed", now,
			)
			result.addFailure(item, errors.Join(deleteErr, rescheduleErr))
			continue
		}
		completeErr := processor.completeCleanup(ctx, item, now)
		if completeErr != nil {
			rescheduled, rescheduleErr := processor.repository.RescheduleReviewCleanup(
				ctx, item, now.Add(reviewCleanupRetryDelay(item.Attempts+1)),
				"asset review cleanup completion failed", now,
			)
			if rescheduleErr != nil {
				completeErr = errors.Join(completeErr, rescheduleErr)
			} else if !rescheduled {
				completeErr = errors.Join(completeErr, errors.New("reschedule asset review cleanup lease lost"))
			}
			result.addFailure(item, completeErr)
			continue
		}
		result.Completed++
	}
	return result
}

func (processor *ReviewCleanupProcessor) completeCleanup(ctx context.Context, item ReviewCleanupOutbox, now time.Time) error {
	return processor.transactions.WithinTransaction(ctx, func(tx context.Context) error {
		ok, err := processor.repository.CompleteReviewCleanup(tx, item, now)
		if err != nil {
			return err
		}
		if !ok {
			return errors.New("complete asset review cleanup lease lost")
		}
		if item.QuotaReservationID != "" && processor.quota != nil {
			if _, err = processor.quota.CompletePresetEntitlementCleanup(tx, item.QuotaReservationID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (result *ReviewCleanupResult) addFailure(item ReviewCleanupOutbox, err error) {
	result.Failed++
	result.Failures = append(result.Failures, ReviewCleanupFailure{
		ReviewID: item.ReviewID, AssetID: item.AssetID, ProviderAssetID: item.ProviderAssetID,
		Attempt: item.Attempts + 1, Err: err,
	})
}

func (processor *ReviewCleanupProcessor) deleteReviewedAsset(ctx context.Context, item ReviewCleanupOutbox) error {
	accessKeyID, err := processor.cipher.Decrypt(item.TenantID, item.EncryptedAccessKeyID)
	if err != nil {
		return fmt.Errorf("decrypt asset review access key: %w", err)
	}
	secretAccessKey, err := processor.cipher.Decrypt(item.TenantID, item.EncryptedSecretAccessKey)
	if err != nil {
		return fmt.Errorf("decrypt asset review secret key: %w", err)
	}
	return processor.provider.DeleteAsset(ctx, DeleteReviewedAssetInput{
		ProviderAssetID: item.ProviderAssetID, ProjectName: item.ProjectName,
		AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey,
	})
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
