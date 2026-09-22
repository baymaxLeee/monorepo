package task

import (
	"context"
	"errors"
	"time"

	"golang.org/x/sync/errgroup"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
)

const (
	asyncDispatchConcurrency = 8
	asyncDispatchClaimLimit  = asyncDispatchConcurrency
	asyncDispatchLease       = 2 * time.Minute
	asyncPublishTimeout      = time.Minute
	asyncDispatchMaxBackoff  = 5 * time.Minute

	asyncRecoveryExpiredErrorCode    = "ASYNC_RECOVERY_EXPIRED"
	asyncRecoveryExpiredErrorMessage = "asynchronous execution recovery window expired"
	asyncRunTypeMismatchErrorCode    = "ASYNC_RUN_TYPE_MISMATCH"
	asyncRunTypeMismatchErrorMessage = "asynchronous dispatch run type does not match task run"
)

type AsyncMessage struct {
	TaskRunID string `json:"TaskRunID"`
}

type AsyncDispatcher struct {
	dispatches   AsyncDispatchStore
	runs         TaskRunReader
	publisher    AsyncPublisher
	processors   map[domain.RunType]AsyncExecutionEventProcessor
	transactions TransactionManager
	clock        Clock
}

func NewAsyncDispatcher(
	dispatches AsyncDispatchStore,
	runs TaskRunReader,
	publisher AsyncPublisher,
	processors []AsyncExecutionEventProcessor,
	transactions TransactionManager,
	clock Clock,
) *AsyncDispatcher {
	byRunType := make(map[domain.RunType]AsyncExecutionEventProcessor, len(processors))
	for _, processor := range processors {
		if processor != nil {
			byRunType[domain.RunType(processor.RunType())] = processor
		}
	}
	return &AsyncDispatcher{
		dispatches: dispatches, runs: runs, publisher: publisher,
		processors: byRunType, transactions: transactions, clock: clock,
	}
}

func (d *AsyncDispatcher) DispatchDue(ctx context.Context) (int, error) {
	if d.dispatches == nil || d.runs == nil || d.publisher == nil ||
		d.transactions == nil || d.clock == nil {
		return 0, errors.New("async dispatcher dependencies are not configured")
	}
	now := d.clock.Now()
	claims, err := d.dispatches.ClaimDueAsyncDispatches(
		ctx, now, now.Add(asyncDispatchLease), asyncDispatchClaimLimit,
	)
	if err != nil {
		return 0, err
	}
	var group errgroup.Group
	group.SetLimit(asyncDispatchConcurrency)
	for index := range claims {
		claim := claims[index]
		group.Go(func() error {
			workCtx := logcontext.WithBusiness(ctx, logcontext.Business{TaskRunID: claim.TaskRunID})
			publishCtx, cancel := context.WithTimeout(workCtx, asyncPublishTimeout)
			defer cancel()
			return NewClaimError(claim.TaskRunID, d.processClaim(publishCtx, claim))
		})
	}
	return len(claims), group.Wait()
}

func (d *AsyncDispatcher) processClaim(ctx context.Context, dispatch domain.AsyncDispatch) error {
	run, err := d.runs.GetTaskRun(ctx, dispatch.TaskRunID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return d.dispatches.DeleteAsyncDispatch(ctx, dispatch.TaskRunID)
		}
		return err
	}
	if run.Terminal() || run.HiddenAt != nil {
		return d.dispatches.DeleteAsyncDispatch(ctx, dispatch.TaskRunID)
	}
	allowed, err := CanExecuteTaskRun(ctx, d.runs, run)
	if err != nil {
		return err
	}
	if !allowed {
		return d.dispatches.DeleteAsyncDispatch(ctx, dispatch.TaskRunID)
	}
	if run.RunType != dispatch.RunType {
		return d.failDispatch(
			ctx, dispatch, run.RunType,
			asyncRunTypeMismatchErrorCode, asyncRunTypeMismatchErrorMessage,
		)
	}
	if dispatch.ExecutionState == domain.AsyncExecutionFailurePending {
		return d.convergeFailure(ctx, dispatch, dispatch.RunType)
	}
	if dispatch.RecoveryExpired(d.clock.Now()) {
		return d.failDispatch(
			ctx, dispatch, dispatch.RunType,
			asyncRecoveryExpiredErrorCode, asyncRecoveryExpiredErrorMessage,
		)
	}
	topic := domain.AsyncTopic(dispatch.RunType)
	if topic == "" {
		return errors.New("async dispatch run type has no MQ topic")
	}
	if err = d.publisher.Publish(ctx, topic, AsyncMessage{TaskRunID: dispatch.TaskRunID}); err != nil {
		return d.reschedule(ctx, dispatch)
	}
	_, err = d.dispatches.MarkAsyncDispatchDelivered(ctx, dispatch, d.clock.Now())
	return err
}

func (d *AsyncDispatcher) failDispatch(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	processorRunType domain.RunType,
	errorCode string,
	errorMessage string,
) error {
	if dispatch.ExecutionState != domain.AsyncExecutionFailurePending {
		var marked bool
		var err error
		dispatch, marked, err = d.dispatches.MarkAsyncDispatchFailurePending(
			ctx, dispatch, errorCode, errorMessage, d.clock.Now(),
		)
		if err != nil || !marked {
			return err
		}
	}
	return d.convergeFailure(ctx, dispatch, processorRunType)
}

func (d *AsyncDispatcher) convergeFailure(
	ctx context.Context,
	dispatch domain.AsyncDispatch,
	processorRunType domain.RunType,
) error {
	processor := d.processors[processorRunType]
	if processor == nil {
		return errors.New("async failure processor is not configured")
	}
	return d.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		if err := processor.CommitFailure(txCtx, dispatch.TaskRunID); err != nil {
			return err
		}
		completed, err := d.dispatches.CompleteAsyncExecution(txCtx, dispatch)
		if err != nil {
			return err
		}
		if !completed {
			return errors.New("async failure convergence fence lost")
		}
		return nil
	})
}

func (d *AsyncDispatcher) reschedule(ctx context.Context, dispatch domain.AsyncDispatch) error {
	now := d.clock.Now()
	backoff := time.Second << min(dispatch.PublishAttempts, 8)
	if backoff > asyncDispatchMaxBackoff {
		backoff = asyncDispatchMaxBackoff
	}
	_, _, err := d.dispatches.RescheduleAsyncDispatch(
		ctx,
		dispatch,
		now.Add(backoff),
		"MQ_UNAVAILABLE",
		"message queue temporarily unavailable",
		now,
	)
	return err
}
