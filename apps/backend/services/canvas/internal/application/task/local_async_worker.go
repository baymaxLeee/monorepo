package task

import (
	"context"
	"errors"
	"sync"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

const (
	localAsyncClaimLease        = 2 * time.Minute
	localAsyncExecutionTimeout  = 45 * time.Minute
	localAsyncHeartbeatInterval = 2 * time.Minute
)

// LocalAsyncExecutor keeps a Canvas-owned durable task inside the Canvas
// boundary. Implementations must be idempotent because an expired execution
// lease can be reclaimed after a worker process exits.
type LocalAsyncExecutor interface {
	RunType() domain.RunType
	Execute(context.Context, string) error
	CommitFailure(context.Context, string) error
}

type LocalAsyncStore interface {
	ClaimDueAsyncDispatches(context.Context, time.Time, time.Time, int) ([]domain.AsyncDispatch, error)
	CompleteAsyncExecution(context.Context, domain.AsyncDispatch) (bool, error)
}

type LocalAsyncCoordinator interface {
	Claim(context.Context, string, domain.RunType) (domain.AsyncDispatch, bool, error)
	Heartbeat(context.Context, domain.AsyncDispatch) (domain.AsyncDispatch, bool, error)
	Release(context.Context, domain.AsyncDispatch) (bool, error)
}

type LocalAsyncWorker struct {
	store       LocalAsyncStore
	coordinator LocalAsyncCoordinator
	executors   map[domain.RunType]LocalAsyncExecutor
	clock       Clock
}

func NewLocalAsyncWorker(
	store LocalAsyncStore,
	coordinator LocalAsyncCoordinator,
	executors []LocalAsyncExecutor,
	clock Clock,
) *LocalAsyncWorker {
	byRunType := make(map[domain.RunType]LocalAsyncExecutor, len(executors))
	for _, executor := range executors {
		if executor != nil {
			byRunType[executor.RunType()] = executor
		}
	}
	return &LocalAsyncWorker{store: store, coordinator: coordinator, executors: byRunType, clock: clock}
}

func (worker *LocalAsyncWorker) Claim(ctx context.Context, limit int) ([]domain.AsyncDispatch, error) {
	if worker == nil || worker.store == nil || worker.coordinator == nil || worker.clock == nil {
		return nil, errors.New("local async worker is not configured")
	}
	if limit <= 0 {
		return nil, nil
	}
	now := worker.clock.Now()
	return worker.store.ClaimDueAsyncDispatches(ctx, now, now.Add(localAsyncClaimLease), limit)
}

func (worker *LocalAsyncWorker) ProcessClaim(ctx context.Context, claim domain.AsyncDispatch) error {
	executor := worker.executors[claim.RunType]
	if executor == nil {
		return errors.New("local async executor is not configured")
	}
	if claim.ExecutionState == domain.AsyncExecutionFailurePending {
		return worker.commitFailure(ctx, executor, claim)
	}

	dispatch, claimed, err := worker.coordinator.Claim(ctx, claim.TaskRunID, claim.RunType)
	if err != nil || !claimed {
		return err
	}
	if dispatch.RecoveryExpired(worker.clock.Now()) {
		return worker.commitFailure(ctx, executor, dispatch)
	}

	workCtx, cancel := context.WithTimeout(ctx, localAsyncExecutionTimeout)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- executor.Execute(workCtx, claim.TaskRunID) }()

	var dispatchMu sync.Mutex
	current := dispatch
	ticker := time.NewTicker(localAsyncHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case executeErr := <-done:
			dispatchMu.Lock()
			latest := current
			dispatchMu.Unlock()
			if executeErr == nil {
				completed, completeErr := worker.store.CompleteAsyncExecution(ctx, latest)
				if completeErr != nil {
					return completeErr
				}
				if !completed {
					return errors.New("local async completion fence lost")
				}
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if latest.RecoveryExpired(worker.clock.Now()) {
				return worker.commitFailure(ctx, executor, latest)
			}
			_, releaseErr := worker.coordinator.Release(ctx, latest)
			return errors.Join(executeErr, releaseErr)
		case <-ticker.C:
			dispatchMu.Lock()
			latest := current
			dispatchMu.Unlock()
			updated, continued, heartbeatErr := worker.coordinator.Heartbeat(workCtx, latest)
			if heartbeatErr != nil || !continued {
				cancel()
				<-done
				return errors.Join(heartbeatErr, errors.New("local async execution lease lost"))
			}
			dispatchMu.Lock()
			current = updated
			dispatchMu.Unlock()
		case <-workCtx.Done():
			cancel()
			<-done
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return workCtx.Err()
		}
	}
}

func (worker *LocalAsyncWorker) commitFailure(
	ctx context.Context,
	executor LocalAsyncExecutor,
	dispatch domain.AsyncDispatch,
) error {
	if err := executor.CommitFailure(ctx, dispatch.TaskRunID); err != nil {
		return err
	}
	completed, err := worker.store.CompleteAsyncExecution(ctx, dispatch)
	if err != nil {
		return err
	}
	if !completed {
		return errors.New("local async failure completion fence lost")
	}
	return nil
}
