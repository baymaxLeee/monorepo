package task

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	platformtracecontext "github.com/example/monorepo/canvas/pkg/platform/tracecontext"
)

const (
	pollProcessingTimeout = 10 * time.Minute
	pollLease             = 12 * time.Minute
)

// PollScheduler owns reusable due-work claiming and lease fencing. A
// PollProcessor owns each target's provider interaction and result handling.
type PollScheduler struct {
	schedules  PollScheduleStore
	runs       TaskRunReader
	processors map[domaintask.RunType]PollProcessor
	executions *ActiveExecutions
	clock      Clock
}

func NewPollScheduler(schedules PollScheduleStore, runs TaskRunReader, processors []PollProcessor, executions *ActiveExecutions, clock Clock) *PollScheduler {
	byRunType := make(map[domaintask.RunType]PollProcessor, len(processors))
	for _, processor := range processors {
		if processor != nil {
			byRunType[processor.RunType()] = processor
		}
	}
	return &PollScheduler{schedules: schedules, runs: runs, processors: byRunType, executions: executions, clock: clock}
}

// Claim reserves only available execution capacity; leases must not age in a local queue.
func (s *PollScheduler) Claim(ctx context.Context, limit int) ([]domaintask.PollSchedule, error) {
	if s.schedules == nil || s.runs == nil || s.executions == nil || s.clock == nil {
		return nil, errors.New("task poll scheduler dependencies are not configured")
	}
	if limit <= 0 {
		return nil, nil
	}
	now := s.clock.Now()
	return s.schedules.ClaimDuePollSchedules(ctx, now, now.Add(pollLease), limit)
}

func (s *PollScheduler) ProcessClaim(ctx context.Context, claim domaintask.PollSchedule) error {
	if s.schedules == nil || s.runs == nil || s.executions == nil || s.clock == nil {
		return errors.New("task poll scheduler dependencies are not configured")
	}
	workCtx := trace.ContextWithSpanContext(ctx, trace.SpanContextFromContext(ctx))
	workCtx = logcontext.WithBusiness(workCtx, logcontext.Business{TaskRunID: claim.TaskRunID})
	pollCtx, cancel := context.WithTimeout(workCtx, pollProcessingTimeout)
	defer cancel()
	return platformtracecontext.WrapError(workCtx, NewClaimError(claim.TaskRunID, s.processClaim(pollCtx, claim)))
}

func (s *PollScheduler) processClaim(ctx context.Context, schedule domaintask.PollSchedule) error {
	run, err := s.runs.GetTaskRun(ctx, schedule.TaskRunID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			_, completeErr := s.schedules.CompletePollSchedule(ctx, schedule)
			return completeErr
		}
		return err
	}
	if run.Terminal() || run.HiddenAt != nil {
		_, err := s.schedules.CompletePollSchedule(ctx, schedule)
		return err
	}
	allowed, err := CanExecuteTaskRun(ctx, s.runs, run)
	if err != nil {
		return err
	}
	if !allowed {
		_, err = s.schedules.CompletePollSchedule(ctx, schedule)
		return err
	}
	processor, ok := s.processors[run.RunType]
	if !ok {
		return fmt.Errorf("task poll processor is not configured for %s", run.RunType)
	}
	return s.executions.Run(ctx, run.ID, func(executionCtx context.Context) error {
		// Register first and then refresh TaskRun. This closes the race where an
		// explicit cancel commits immediately before this pod starts the claim.
		current, getErr := s.runs.GetTaskRun(executionCtx, run.ID)
		if getErr != nil {
			return getErr
		}
		if current.Terminal() || current.HiddenAt != nil {
			_, completeErr := s.schedules.CompletePollSchedule(executionCtx, schedule)
			return completeErr
		}
		allowed, admissionErr := CanExecuteTaskRun(executionCtx, s.runs, current)
		if admissionErr != nil {
			return admissionErr
		}
		if !allowed {
			_, completeErr := s.schedules.CompletePollSchedule(executionCtx, schedule)
			return completeErr
		}
		return processor.ProcessPollClaim(executionCtx, current, schedule)
	})
}
