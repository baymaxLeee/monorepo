package task

import (
	"context"
	"errors"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

const (
	archiveExecutionLease        = 6 * time.Minute
	firstLastFrameExecutionLease = 6 * time.Minute
	asyncExecutionRetryDelay     = 3 * time.Second

	asyncPayloadNotReadyErrorCode    = "EXECUTION_PAYLOAD_NOT_READY"
	asyncPayloadNotReadyErrorMessage = "asynchronous execution payload is not ready"
)

type AsyncExecutionCoordinator struct {
	dispatches   AsyncExecutionStore
	runs         TaskRunReader
	transactions TransactionManager
	starters     map[domain.RunType]AsyncExecutionStarter
	ids          IDGenerator
	clock        Clock
}

func NewAsyncExecutionCoordinator(
	dispatches AsyncExecutionStore,
	runs TaskRunReader,
	transactions TransactionManager,
	starters []AsyncExecutionStarter,
	ids IDGenerator,
	clock Clock,
) *AsyncExecutionCoordinator {
	byRunType := make(map[domain.RunType]AsyncExecutionStarter, len(starters))
	for _, starter := range starters {
		if starter != nil {
			byRunType[starter.RunType()] = starter
		}
	}
	return &AsyncExecutionCoordinator{
		dispatches: dispatches, runs: runs, transactions: transactions,
		starters: byRunType, ids: ids, clock: clock,
	}
}

func (c *AsyncExecutionCoordinator) Claim(
	ctx context.Context,
	taskRunID string,
	runType domain.RunType,
) (domain.AsyncDispatch, bool, error) {
	if c.dispatches == nil || c.runs == nil || c.transactions == nil || c.ids == nil || c.clock == nil {
		return domain.AsyncDispatch{}, false, errors.New("async execution coordinator is not configured")
	}
	now := c.clock.Now()
	var claim domain.AsyncDispatch
	var claimed bool
	err := c.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		run, err := c.runs.GetTaskRun(txCtx, taskRunID)
		if err != nil {
			return err
		}
		if run.RunType != runType || run.Terminal() || run.HiddenAt != nil {
			return nil
		}
		allowed, admissionErr := CanExecuteTaskRun(txCtx, c.runs, run)
		if admissionErr != nil || !allowed {
			return admissionErr
		}
		lease, ok := executionLease(runType)
		if !ok {
			return nil
		}
		executionToken, tokenErr := c.ids.NewID()
		if tokenErr != nil {
			return tokenErr
		}
		claim, claimed, err = c.dispatches.ClaimAsyncExecution(
			txCtx, taskRunID, executionToken, now, now.Add(lease),
		)
		if err != nil || !claimed {
			return err
		}
		if claim.RunType != runType {
			return errors.New("async execution run type mismatch")
		}
		if run.Status == domain.StatusQueued {
			starter := c.starters[runType]
			if starter == nil {
				return errors.New("async execution starter is not configured")
			}
			return starter.MarkStarted(txCtx, run, claim, now)
		}
		if run.Status != domain.StatusRunning {
			claimed = false
		}
		return nil
	})
	return claim, claimed, err
}

func (c *AsyncExecutionCoordinator) Heartbeat(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
) (domain.AsyncDispatch, bool, error) {
	lease, ok := executionLease(dispatch.RunType)
	if !ok {
		return domain.AsyncDispatch{}, false, nil
	}
	now := c.clock.Now()
	return c.dispatches.HeartbeatAsyncExecution(ctx, dispatch, now, now.Add(lease))
}

func (c *AsyncExecutionCoordinator) Release(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
) (bool, error) {
	if c.dispatches == nil || c.clock == nil {
		return false, errors.New("async execution coordinator is not configured")
	}
	now := c.clock.Now()
	_, released, err := c.dispatches.ReleaseAsyncExecution(
		ctx,
		dispatch,
		now.Add(asyncExecutionRetryDelay),
		asyncPayloadNotReadyErrorCode,
		asyncPayloadNotReadyErrorMessage,
		now,
	)
	return released, err
}

func (c *AsyncExecutionCoordinator) Complete(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
) (bool, error) {
	if c.dispatches == nil {
		return false, errors.New("async execution coordinator is not configured")
	}
	return c.dispatches.CompleteAsyncExecution(ctx, dispatch)
}

func executionLease(runType domain.RunType) (time.Duration, bool) {
	switch runType {
	case domain.RunTypeCanvasVideoArchiveExport:
		return archiveExecutionLease, true
	case domain.RunTypeCanvasNodeVideoFirstLastFrameExtraction:
		return firstLastFrameExecutionLease, true
	default:
		return 0, false
	}
}
