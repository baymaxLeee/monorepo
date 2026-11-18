//go:build integration

package task

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

func TestExpiredExecutionFencesThePreviousWorker(t *testing.T) {
	ctx := context.Background()
	dsn := os.Getenv("CANVAS_STREAM_TEST_DSN")
	if dsn == "" {
		t.Fatal("CANVAS_STREAM_TEST_DSN required")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := transaction.New(pool)
	repo := NewRepository(store)
	now := time.Now().UTC().Truncate(time.Millisecond)
	expiredAt := now.Add(time.Minute)
	rollback := errors.New("rollback test data")
	for _, test := range []struct {
		name            string
		priorRecoveries int32
		want            domain.AsyncExecutionState
	}{
		{"republish", 0, domain.AsyncExecutionWaiting}, {"exhausted", 9, domain.AsyncExecutionFailurePending},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := store.WithinTransaction(ctx, func(ctx context.Context) error {
				id := uuid.Must(uuid.NewV7()).String()
				run := domain.TaskRun{ID: id, TenantID: id, CreatedBy: "creator", RunType: domain.RunTypeCanvasVideoArchiveExport, SubjectType: domain.SubjectTypeCanvas, SubjectID: id, Status: domain.StatusQueued, StateVersion: 1, CreatedAt: now, UpdatedAt: now}
				if err := repo.Create(ctx, run); err != nil {
					return err
				}
				dispatch := domain.AsyncDispatch{TaskRunID: id, RunType: run.RunType, DeliveryState: domain.AsyncDeliveryPending, ExecutionState: domain.AsyncExecutionWaiting, NextDispatchAt: now,
					DeliveryVersion: 1, ExecutionVersion: 1, LeaseRecoveries: test.priorRecoveries, CreatedAt: now, UpdatedAt: now}
				if err := repo.CreateAsyncDispatch(ctx, dispatch); err != nil {
					return err
				}
				claimed, err := repo.ClaimDueAsyncDispatches(ctx, now, expiredAt, 1)
				if err != nil {
					return err
				}
				if len(claimed) != 1 || claimed[0].TaskRunID != id {
					t.Fatalf("publish claim=%+v", claimed)
				}
				worker, ok, err := repo.ClaimAsyncExecution(ctx, id, uuid.NewString(), now, expiredAt)
				if err != nil {
					return err
				}
				if !ok || worker.ExecutionAttempts != 1 || worker.FirstStartedAt == nil {
					t.Fatalf("execution claim=%+v ok=%v", worker, ok)
				}
				recovered, err := repo.ClaimDueAsyncDispatches(ctx, expiredAt, expiredAt.Add(time.Minute), 1)
				if err != nil {
					return err
				}
				if len(recovered) != 1 || recovered[0].ExecutionState != test.want || recovered[0].ExecutionToken != "" || recovered[0].LeaseRecoveries != test.priorRecoveries+1 {
					t.Fatalf("recovered=%+v", recovered)
				}
				if _, ok, err := repo.HeartbeatAsyncExecution(ctx, worker, expiredAt, expiredAt.Add(time.Hour)); err != nil || ok {
					t.Fatalf("stale heartbeat ok=%v err=%v", ok, err)
				}
				if test.want == domain.AsyncExecutionFailurePending && (recovered[0].LastErrorCode != executionLeaseExpiredErrorCode || recovered[0].ExecutionLeaseUntil == nil) {
					t.Fatalf("missing failure lease: %+v", recovered[0])
				}
				return rollback
			})
			if !errors.Is(err, rollback) {
				t.Fatal(err)
			}
		})
	}
}
