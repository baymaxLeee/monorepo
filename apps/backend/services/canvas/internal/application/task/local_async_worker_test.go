package task

import (
	"context"
	"errors"
	"testing"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

type localAsyncTestClock struct{ now time.Time }

func (clock localAsyncTestClock) Now() time.Time { return clock.now }

type localAsyncTestStore struct {
	claims    []domain.AsyncDispatch
	completed []domain.AsyncDispatch
}

func (store *localAsyncTestStore) ClaimDueAsyncDispatches(
	context.Context,
	time.Time,
	time.Time,
	int,
) ([]domain.AsyncDispatch, error) {
	return store.claims, nil
}

func (store *localAsyncTestStore) CompleteAsyncExecution(
	_ context.Context,
	dispatch domain.AsyncDispatch,
) (bool, error) {
	store.completed = append(store.completed, dispatch)
	return true, nil
}

type localAsyncTestCoordinator struct {
	dispatch domain.AsyncDispatch
	released []domain.AsyncDispatch
}

func (coordinator *localAsyncTestCoordinator) Claim(
	context.Context,
	string,
	domain.RunType,
) (domain.AsyncDispatch, bool, error) {
	return coordinator.dispatch, true, nil
}

func (coordinator *localAsyncTestCoordinator) Heartbeat(
	_ context.Context,
	dispatch domain.AsyncDispatch,
) (domain.AsyncDispatch, bool, error) {
	return dispatch, true, nil
}

func (coordinator *localAsyncTestCoordinator) Release(
	_ context.Context,
	dispatch domain.AsyncDispatch,
) (bool, error) {
	coordinator.released = append(coordinator.released, dispatch)
	return true, nil
}

type localAsyncTestExecutor struct {
	runType domain.RunType
	err     error
	failed  []string
}

func (executor *localAsyncTestExecutor) RunType() domain.RunType { return executor.runType }
func (executor *localAsyncTestExecutor) Execute(context.Context, string) error {
	return executor.err
}
func (executor *localAsyncTestExecutor) CommitFailure(_ context.Context, taskRunID string) error {
	executor.failed = append(executor.failed, taskRunID)
	return nil
}

func localAsyncTestDispatch(now time.Time) domain.AsyncDispatch {
	leaseUntil := now.Add(time.Minute)
	return domain.AsyncDispatch{
		TaskRunID:           "019a0000-0000-7000-8000-000000000001",
		RunType:             domain.RunTypeCanvasVideoArchiveExport,
		ExecutionState:      domain.AsyncExecutionExecuting,
		ExecutionLeaseUntil: &leaseUntil,
		ExecutionToken:      "token",
		ExecutionVersion:    2,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
}

func TestLocalAsyncWorkerCompletesSuccessfulExecution(t *testing.T) {
	now := time.Now().UTC()
	dispatch := localAsyncTestDispatch(now)
	store := &localAsyncTestStore{}
	coordinator := &localAsyncTestCoordinator{dispatch: dispatch}
	executor := &localAsyncTestExecutor{runType: dispatch.RunType}
	worker := NewLocalAsyncWorker(store, coordinator, []LocalAsyncExecutor{executor}, localAsyncTestClock{now: now})

	if err := worker.ProcessClaim(context.Background(), dispatch); err != nil {
		t.Fatalf("ProcessClaim() error = %v", err)
	}
	if len(store.completed) != 1 || len(coordinator.released) != 0 {
		t.Fatalf("completed = %d, released = %d", len(store.completed), len(coordinator.released))
	}
}

func TestLocalAsyncWorkerReleasesRetryableExecution(t *testing.T) {
	now := time.Now().UTC()
	dispatch := localAsyncTestDispatch(now)
	store := &localAsyncTestStore{}
	coordinator := &localAsyncTestCoordinator{dispatch: dispatch}
	executor := &localAsyncTestExecutor{runType: dispatch.RunType, err: errors.New("storage unavailable")}
	worker := NewLocalAsyncWorker(store, coordinator, []LocalAsyncExecutor{executor}, localAsyncTestClock{now: now})

	if err := worker.ProcessClaim(context.Background(), dispatch); err == nil {
		t.Fatal("ProcessClaim() error = nil, want execution failure")
	}
	if len(coordinator.released) != 1 || len(store.completed) != 0 || len(executor.failed) != 0 {
		t.Fatalf("released = %d, completed = %d, failed = %d", len(coordinator.released), len(store.completed), len(executor.failed))
	}
}

func TestLocalAsyncWorkerConvergesExpiredExecution(t *testing.T) {
	now := time.Now().UTC()
	dispatch := localAsyncTestDispatch(now.Add(-domain.AsyncExecutionRecoveryWindow - time.Minute))
	store := &localAsyncTestStore{}
	coordinator := &localAsyncTestCoordinator{dispatch: dispatch}
	executor := &localAsyncTestExecutor{runType: dispatch.RunType}
	worker := NewLocalAsyncWorker(store, coordinator, []LocalAsyncExecutor{executor}, localAsyncTestClock{now: now})

	if err := worker.ProcessClaim(context.Background(), dispatch); err != nil {
		t.Fatalf("ProcessClaim() error = %v", err)
	}
	if len(executor.failed) != 1 || len(store.completed) != 1 {
		t.Fatalf("failed = %d, completed = %d", len(executor.failed), len(store.completed))
	}
}
