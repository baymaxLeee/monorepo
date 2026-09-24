package application

import (
	"context"
	"errors"
	"time"
)

type Collector struct {
	repository   Repository
	storage      BlobStore
	clock        Clock
	candidateAge time.Duration
	retention    time.Duration
}

func NewCollector(repository Repository, storage BlobStore, clock Clock, candidateAge, retention time.Duration) *Collector {
	return &Collector{repository: repository, storage: storage, clock: clock, candidateAge: candidateAge, retention: retention}
}

func (c *Collector) Run(ctx context.Context, limit int) error {
	now := c.clock.Now()
	var failures error
	if _, err := c.repository.ExpireLeases(ctx, now, limit); err != nil {
		failures = errors.Join(failures, err)
	}
	if _, err := c.repository.ReconcileBlockingClaimCounts(ctx, now, limit); err != nil {
		failures = errors.Join(failures, err)
	}
	expiredUploads, err := c.repository.ClaimExpiredUploads(ctx, now, now.Add(2*time.Minute), limit)
	if err != nil {
		failures = errors.Join(failures, err)
	} else {
		for _, upload := range expiredUploads {
			if cleanupErr := c.storage.CleanupUpload(ctx, upload.ID); cleanupErr != nil {
				failures = errors.Join(failures, cleanupErr)
				continue
			}
			failures = errors.Join(failures, c.repository.CompleteUploadCleanup(context.WithoutCancel(ctx), upload))
		}
	}
	if _, err = c.repository.MarkCandidates(ctx, now.Add(-c.candidateAge), now, now.Add(c.retention), limit); err != nil {
		failures = errors.Join(failures, err)
	}
	candidates, err := c.repository.ClaimDeletions(ctx, now, now.Add(2*time.Minute), limit)
	if err != nil {
		return errors.Join(failures, err)
	}
	for _, candidate := range candidates {
		var deletionErr error
		for _, blob := range candidate.Blobs {
			deletionErr = errors.Join(deletionErr, c.storage.Delete(ctx, blob.StorageKey))
		}
		if deletionErr != nil {
			failures = errors.Join(failures, deletionErr, c.repository.RetryDeletion(context.WithoutCancel(ctx), candidate, c.clock.Now(), "blob_delete_failed"))
			continue
		}
		failures = errors.Join(failures, c.repository.CompleteDeletion(context.WithoutCancel(ctx), candidate, c.clock.Now()))
	}
	return failures
}
