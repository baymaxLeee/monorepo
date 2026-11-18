//go:build integration

package deletion

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	application "github.com/example/monorepo/canvas/internal/application/deletion"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

func TestClaimAndFinishDeletionJob(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN must point to an isolated migrated Canvas database")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	r := NewRepository(transaction.New(pool))
	now := time.Now().UTC().Truncate(time.Millisecond)
	id := uuid.NewString()
	defer pool.Exec(ctx, "DELETE FROM deletion_jobs WHERE id=$1", id)
	err = r.Enqueue(ctx, application.Job{ID: id, TenantID: "tenant", Kind: "cleanup", Payload: []byte("{}"), NextAttemptAt: now})
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := r.Claim(ctx, now, now.Add(time.Minute), 1)
	if err != nil || len(jobs) != 1 || jobs[0].ID != id {
		t.Fatalf("claim: %+v %v", jobs, err)
	}
	first := jobs[0]
	jobs, err = r.Claim(ctx, now, now.Add(time.Minute), 1)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("duplicate lease: %+v %v", jobs, err)
	}
	if err = r.Finish(ctx, first, now, errors.New("retry")); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	jobs, err = r.Claim(ctx, now, now.Add(time.Minute), 1)
	if err != nil || len(jobs) != 1 || jobs[0].Attempts != 1 {
		t.Fatalf("retry lease: %+v %v", jobs, err)
	}
	if err = r.Finish(ctx, first, now, nil); err == nil {
		t.Fatal("stale worker completed newer lease")
	}
	if err = r.Finish(ctx, jobs[0], now, nil); err != nil {
		t.Fatal(err)
	}
	jobs, err = r.Claim(ctx, now.Add(time.Hour), now.Add(2*time.Hour), 1)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("completed job reclaimed: %+v %v", jobs, err)
	}
}
