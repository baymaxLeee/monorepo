package application

import (
	"context"
	"errors"
	"testing"
	"time"
)

type collectorRepositoryStub struct {
	Repository
	candidates       []DeletionCandidate
	expiredUploads   []ExpiredUpload
	completed        []string
	cleanedUploads   []string
	retried          []string
	markedAt         time.Time
	reconciledClaims bool
}

func (stub *collectorRepositoryStub) ExpireLeases(context.Context, time.Time, int) (int, error) {
	return 0, nil
}
func (stub *collectorRepositoryStub) ReconcileBlockingClaimCounts(context.Context, time.Time, int) (int, error) {
	stub.reconciledClaims = true
	return 0, nil
}
func (stub *collectorRepositoryStub) ClaimExpiredUploads(context.Context, time.Time, time.Time, int) ([]ExpiredUpload, error) {
	return stub.expiredUploads, nil
}
func (stub *collectorRepositoryStub) CompleteUploadCleanup(_ context.Context, upload ExpiredUpload) error {
	stub.cleanedUploads = append(stub.cleanedUploads, upload.ID)
	return nil
}
func (stub *collectorRepositoryStub) MarkCandidates(_ context.Context, _, now, _ time.Time, _ int) (int, error) {
	stub.markedAt = now
	return 0, nil
}
func (stub *collectorRepositoryStub) ClaimDeletions(context.Context, time.Time, time.Time, int) ([]DeletionCandidate, error) {
	return stub.candidates, nil
}
func (stub *collectorRepositoryStub) CompleteDeletion(_ context.Context, candidate DeletionCandidate, _ time.Time) error {
	stub.completed = append(stub.completed, candidate.AssetID)
	return nil
}
func (stub *collectorRepositoryStub) RetryDeletion(_ context.Context, candidate DeletionCandidate, _ time.Time, _ string) error {
	stub.retried = append(stub.retried, candidate.AssetID)
	return nil
}

type collectorStorageStub struct {
	BlobStore
	failKey        string
	failUploadID   string
	deleted        []string
	cleanedUploads []string
}

func (stub *collectorStorageStub) CleanupUpload(_ context.Context, uploadID string) error {
	stub.cleanedUploads = append(stub.cleanedUploads, uploadID)
	if uploadID == stub.failUploadID {
		return errors.New("staging unavailable")
	}
	return nil
}

func (stub *collectorStorageStub) Delete(_ context.Context, key string) error {
	stub.deleted = append(stub.deleted, key)
	if key == stub.failKey {
		return errors.New("disk unavailable")
	}
	return nil
}

func TestCollectorRun(t *testing.T) {
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)

	t.Run("confirms an asset after all blob effects succeed", func(t *testing.T) {
		repository := &collectorRepositoryStub{
			expiredUploads: []ExpiredUpload{{ID: "upload-1"}},
			candidates:     []DeletionCandidate{{AssetID: "asset-1", Blobs: []DeletionBlob{{ID: "blob-1", StorageKey: "one"}}}},
		}
		storage := &collectorStorageStub{}
		collector := NewCollector(repository, storage, fixedClock{now}, time.Hour, 24*time.Hour)
		if err := collector.Run(context.Background(), 10); err != nil {
			t.Fatal(err)
		}
		if len(repository.completed) != 1 || len(repository.retried) != 0 {
			t.Fatalf("completed=%v retried=%v", repository.completed, repository.retried)
		}
		if repository.markedAt != now {
			t.Fatalf("candidate timestamp = %v, want %v", repository.markedAt, now)
		}
		if !repository.reconciledClaims {
			t.Fatal("blocking claim counts were not reconciled")
		}
		if len(storage.cleanedUploads) != 1 || storage.cleanedUploads[0] != "upload-1" || len(repository.cleanedUploads) != 1 {
			t.Fatalf("storage cleanup=%v repository cleanup=%v", storage.cleanedUploads, repository.cleanedUploads)
		}
	})

	t.Run("schedules retry and does not confirm partial deletion", func(t *testing.T) {
		repository := &collectorRepositoryStub{candidates: []DeletionCandidate{{AssetID: "asset-1", Blobs: []DeletionBlob{{ID: "blob-1", StorageKey: "one"}, {ID: "blob-2", StorageKey: "two"}}}}}
		storage := &collectorStorageStub{failKey: "two"}
		collector := NewCollector(repository, storage, fixedClock{now}, time.Hour, 24*time.Hour)
		if err := collector.Run(context.Background(), 10); err == nil {
			t.Fatal("expected deletion failure")
		}
		if len(repository.completed) != 0 || len(repository.retried) != 1 {
			t.Fatalf("completed=%v retried=%v", repository.completed, repository.retried)
		}
	})

	t.Run("keeps upload cleanup claim retryable when staging deletion fails", func(t *testing.T) {
		repository := &collectorRepositoryStub{expiredUploads: []ExpiredUpload{{ID: "upload-1"}}}
		storage := &collectorStorageStub{failUploadID: "upload-1"}
		collector := NewCollector(repository, storage, fixedClock{now}, time.Hour, 24*time.Hour)
		if err := collector.Run(context.Background(), 10); err == nil {
			t.Fatal("expected staging cleanup failure")
		}
		if len(repository.cleanedUploads) != 0 {
			t.Fatalf("upload metadata was removed after failed staging cleanup: %v", repository.cleanedUploads)
		}
	})
}
