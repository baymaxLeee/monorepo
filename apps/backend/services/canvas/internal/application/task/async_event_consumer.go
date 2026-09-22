package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	asynccontract "github.com/example/monorepo/canvas/internal/contract/asyncexecution"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
)

const (
	asyncEventClaimLimit = 8
	asyncEventLease      = 30 * time.Second
)

type AsyncEventConsumer struct {
	events       AsyncExecutionEventStore
	runs         AsyncExecutionEventRunStore
	dispatches   AsyncExecutionEventDispatchStore
	processors   map[string]AsyncExecutionEventProcessor
	transactions TransactionManager
	clock        Clock
}

func NewAsyncEventConsumer(
	events AsyncExecutionEventStore,
	runs AsyncExecutionEventRunStore,
	dispatches AsyncExecutionEventDispatchStore,
	processors []AsyncExecutionEventProcessor,
	transactions TransactionManager,
	clock Clock,
) *AsyncEventConsumer {
	byRunType := make(map[string]AsyncExecutionEventProcessor, len(processors))
	for _, processor := range processors {
		if processor != nil {
			byRunType[processor.RunType()] = processor
		}
	}
	return &AsyncEventConsumer{
		events: events, runs: runs, dispatches: dispatches,
		processors: byRunType, transactions: transactions, clock: clock,
	}
}

func (consumer *AsyncEventConsumer) ConsumeDue(ctx context.Context) (int, error) {
	if consumer == nil || consumer.events == nil || consumer.runs == nil ||
		consumer.dispatches == nil || consumer.transactions == nil || consumer.clock == nil {
		return 0, errors.New("async event consumer is not configured")
	}
	now := consumer.clock.Now()
	claims, err := consumer.events.ClaimDueAsyncExecutionEvents(
		ctx, now, now.Add(asyncEventLease), asyncEventClaimLimit,
	)
	if err != nil {
		return 0, err
	}
	var consumeErr error
	for index := range claims {
		event := claims[index]
		workCtx := logcontext.WithBusiness(ctx, logcontext.Business{TaskRunID: event.TaskRunID})
		err = consumer.consume(workCtx, event, now)
		if err != nil {
			consumeErr = errors.Join(consumeErr, NewClaimError(event.TaskRunID, err))
		}
	}
	return len(claims), consumeErr
}

func (consumer *AsyncEventConsumer) consume(
	ctx context.Context,
	event asynccontract.Event,
	now time.Time,
) error {
	unfinished, err := consumer.events.HasUnfinishedAsyncExecutionEventBefore(
		ctx, event.ExecutionToken, event.Sequence,
	)
	if err != nil {
		return consumer.reschedule(ctx, event, now, err)
	}
	if unfinished {
		applied, rescheduleErr := consumer.events.RescheduleAsyncExecutionEvent(
			ctx, event, now.Add(time.Second),
			"RESULT_SEQUENCE_PENDING", "earlier execution result is still pending", now,
		)
		if rescheduleErr != nil {
			return rescheduleErr
		}
		if !applied {
			return errors.New("async execution event reschedule fence lost")
		}
		return nil
	}
	err = consumer.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		run, readErr := consumer.runs.GetTaskRun(txCtx, event.TaskRunID)
		if readErr != nil {
			return readErr
		}
		allowed, admissionErr := CanExecuteTaskRun(txCtx, consumer.runs, run)
		if admissionErr != nil {
			return admissionErr
		}
		if !allowed {
			return consumer.discard(txCtx, event, now)
		}
		dispatch, readErr := consumer.dispatches.GetAsyncDispatch(txCtx, event.TaskRunID)
		if readErr != nil {
			if run.Terminal() || errors.Is(readErr, ErrNotFound) {
				return consumer.discard(txCtx, event, now)
			}
			return readErr
		}
		if run.Terminal() ||
			string(run.RunType) != event.RunType ||
			string(dispatch.RunType) != event.RunType ||
			dispatch.ExecutionState != domaintask.AsyncExecutionExecuting ||
			dispatch.ExecutionToken != event.ExecutionToken {
			return consumer.discard(txCtx, event, now)
		}
		processor, ok := consumer.processors[event.RunType]
		if !ok {
			return fmt.Errorf("async event processor is not configured for %s", event.RunType)
		}
		retryScheduled := false
		switch event.EventType {
		case asynccontract.EventTypeCheckpoint:
			readErr = processor.RecordCheckpoint(txCtx, event.TaskRunID, event.Payload)
		case asynccontract.EventTypeSuccess:
			readErr = processor.CommitSuccess(txCtx, event.TaskRunID, event.Payload)
		case asynccontract.EventTypeFailure:
			var failure asynccontract.FailurePayload
			if json.Unmarshal(event.Payload, &failure) != nil {
				return ErrInvalidAsyncExecutionEventPayload
			}
			if failure.Retryable && dispatch.ExecutionFailures < 2 {
				nextDispatchAt := now.Add(time.Duration(dispatch.ExecutionFailures+1) * 3 * time.Second)
				if failure.NextDispatchAt != nil && failure.NextDispatchAt.After(now) {
					nextDispatchAt = *failure.NextDispatchAt
				}
				_, retryScheduled, readErr = consumer.dispatches.RetryAsyncExecution(
					txCtx, dispatch, nextDispatchAt,
					failure.ErrorCode, failure.ErrorMessage, now,
				)
				if readErr == nil && !retryScheduled {
					return errors.New("async execution retry fence lost")
				}
			} else {
				readErr = processor.CommitFailure(txCtx, event.TaskRunID)
			}
		default:
			return errors.New("invalid async execution event type")
		}
		if readErr != nil {
			return readErr
		}
		if event.EventType != asynccontract.EventTypeCheckpoint && !retryScheduled {
			completed, completeErr := consumer.dispatches.CompleteAsyncExecution(txCtx, dispatch)
			if completeErr != nil {
				return completeErr
			}
			if !completed {
				return errors.New("async execution completion fence lost")
			}
		}
		consumed, consumeErr := consumer.events.MarkAsyncExecutionEventConsumed(txCtx, event, now)
		if consumeErr != nil {
			return consumeErr
		}
		if !consumed {
			return errors.New("async execution event consume fence lost")
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrInvalidAsyncExecutionEventPayload) {
			return consumer.convergeFailedEvent(ctx, event, now, false)
		}
		if dispatch, readErr := consumer.dispatches.GetAsyncDispatch(ctx, event.TaskRunID); readErr == nil &&
			dispatch.RecoveryExpired(now) {
			return consumer.convergeFailedEvent(ctx, event, now, true)
		}
		return consumer.reschedule(ctx, event, now, err)
	}
	return nil
}

func (consumer *AsyncEventConsumer) convergeFailedEvent(
	ctx context.Context,
	event asynccontract.Event,
	now time.Time,
	requireExpired bool,
) error {
	return consumer.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		run, err := consumer.runs.GetTaskRun(txCtx, event.TaskRunID)
		if err != nil {
			return err
		}
		dispatch, err := consumer.dispatches.GetAsyncDispatch(txCtx, event.TaskRunID)
		if err != nil {
			if run.Terminal() || errors.Is(err, ErrNotFound) {
				return consumer.discard(txCtx, event, now)
			}
			return err
		}
		if run.Terminal() ||
			string(run.RunType) != event.RunType ||
			string(dispatch.RunType) != event.RunType ||
			dispatch.ExecutionState != domaintask.AsyncExecutionExecuting ||
			dispatch.ExecutionToken != event.ExecutionToken {
			return consumer.discard(txCtx, event, now)
		}
		if requireExpired && !dispatch.RecoveryExpired(now) {
			return errors.New("async execution recovery window is still active")
		}
		processor, ok := consumer.processors[event.RunType]
		if !ok {
			return fmt.Errorf("async event processor is not configured for %s", event.RunType)
		}
		if err = processor.CommitFailure(txCtx, event.TaskRunID); err != nil {
			return err
		}
		completed, err := consumer.dispatches.CompleteAsyncExecution(txCtx, dispatch)
		if err != nil {
			return err
		}
		if !completed {
			return errors.New("async execution failure convergence fence lost")
		}
		consumed, err := consumer.events.MarkAsyncExecutionEventConsumed(txCtx, event, now)
		if err != nil {
			return err
		}
		if !consumed {
			return errors.New("async execution event consume fence lost")
		}
		return nil
	})
}

func (consumer *AsyncEventConsumer) discard(
	ctx context.Context,
	event asynccontract.Event,
	now time.Time,
) error {
	applied, err := consumer.events.DiscardAsyncExecutionEvent(ctx, event, now)
	if err != nil {
		return err
	}
	if !applied {
		return errors.New("async execution event discard fence lost")
	}
	return nil
}

func (consumer *AsyncEventConsumer) reschedule(
	ctx context.Context,
	event asynccontract.Event,
	now time.Time,
	cause error,
) error {
	backoff := time.Duration(event.ConsumeAttempts) * time.Second
	if backoff > time.Minute {
		backoff = time.Minute
	}
	applied, err := consumer.events.RescheduleAsyncExecutionEvent(
		ctx, event, now.Add(backoff),
		"RESULT_CONSUME_FAILED", "asynchronous result consumption failed", now,
	)
	if err != nil {
		return errors.Join(cause, err)
	}
	if !applied {
		return errors.Join(cause, errors.New("async execution event reschedule fence lost"))
	}
	return cause
}
