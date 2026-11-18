package deletion

import (
	"context"
	"errors"
	"time"

	application "github.com/example/monorepo/canvas/internal/application/deletion"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	transaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *transaction.Store }

func NewRepository(db *transaction.Store) *Repository { return &Repository{db: db} }
func (r *Repository) Enqueue(ctx context.Context, job application.Job) error {
	return r.db.Queries(ctx).EnqueueCanvasDeletionJob(ctx, sqlc.EnqueueCanvasDeletionJobParams{
		ID: job.ID, TenantID: job.TenantID, Kind: job.Kind, Payload: job.Payload, NextAttemptAt: job.NextAttemptAt,
	})
}

func (r *Repository) Claim(ctx context.Context, now, until time.Time, limit int) ([]application.Job, error) {
	rows, err := r.db.Queries(ctx).ClaimDeletionJobs(ctx, sqlc.ClaimDeletionJobsParams{
		ClaimTime:  now,
		LeaseUntil: until,
		BatchSize:  int64(limit),
	})
	if err != nil {
		return nil, err
	}
	jobs := make([]application.Job, len(rows))
	for i, row := range rows {
		jobs[i] = application.Job{ID: row.ID, TenantID: row.TenantID, Kind: row.Kind, Payload: row.Payload, LeaseUntil: &until, StateVersion: row.StateVersion, Attempts: row.Attempts}
	}
	return jobs, nil
}

func (r *Repository) Finish(ctx context.Context, job application.Job, now time.Time, failure error) error {
	var count int64
	var err error
	if failure == nil {
		count, err = r.db.Queries(ctx).FinishDeletionJob(ctx, sqlc.FinishDeletionJobParams{
			ID:           job.ID,
			StateVersion: job.StateVersion,
			FinishTime:   now,
		})
	} else {
		delay := time.Minute
		for attempt := int32(0); attempt < job.Attempts && delay < time.Hour; attempt++ {
			delay *= 2
		}
		if delay > time.Hour {
			delay = time.Hour
		}
		count, err = r.db.Queries(ctx).RetryDeletionJob(ctx, sqlc.RetryDeletionJobParams{
			ID:            job.ID,
			StateVersion:  job.StateVersion,
			FinishTime:    now,
			NextAttemptAt: now.Add(delay),
		})
	}
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("deletion job completion lease lost")
	}
	return nil
}
