package task

import (
	"context"
	"errors"
	"fmt"
	"time"

	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
)

type PollPoolConfig struct {
	RunType                                           domaintask.RunType
	Concurrency                                       int
	ClaimInterval, Lease, Heartbeat, ExecutionTimeout time.Duration
}

func (c PollPoolConfig) Validate() error {
	if c.RunType == "" || c.Concurrency <= 0 || c.ClaimInterval <= 0 || c.Lease <= 0 || c.Heartbeat <= 0 || c.ExecutionTimeout <= 0 {
		return errors.New("poll pool configuration must use positive values")
	}
	if c.Heartbeat >= c.Lease {
		return errors.New("poll pool heartbeat must be shorter than its lease")
	}
	return nil
}

// PollScheduler owns reusable due-work claiming and lease fencing. A
// PollProcessor owns each target's provider interaction and result handling.
type PollScheduler struct {
	schedules  PollScheduleStore
	runs       TaskRunReader
	runType    domaintask.RunType
	processor  PollProcessor
	executions *ActiveExecutions
	clock      Clock
	config     PollPoolConfig
}

func NewRunTypePollScheduler(
	schedules PollScheduleStore,
	runs TaskRunReader,
	processor PollProcessor,
	executions *ActiveExecutions,
	clock Clock,
	config PollPoolConfig,
) (*PollScheduler, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if processor == nil || processor.RunType() != config.RunType {
		return nil, errors.New("poll processor does not match pool run type")
	}
	return &PollScheduler{
		schedules: schedules, runs: runs, processor: processor, runType: config.RunType,
		executions: executions, clock: clock, config: config,
	}, nil
}

func (s *PollScheduler) Config() PollPoolConfig { return s.config }

// Claim reserves only available execution capacity; leases must not age in a local queue.
func (s *PollScheduler) Claim(ctx context.Context, limit int) ([]domaintask.PollSchedule, error) {
	if s.schedules == nil || s.runs == nil || s.executions == nil || s.clock == nil {
		return nil, errors.New("task poll scheduler dependencies are not configured")
	}
	if limit <= 0 {
		return nil, nil
	}
	now := s.clock.Now()
	return s.schedules.ClaimDuePollSchedules(ctx, s.runType, now, now.Add(s.config.Lease), limit)
}

func (s *PollScheduler) ProcessClaim(ctx context.Context, claim domaintask.PollSchedule) error {
	if s.schedules == nil || s.runs == nil || s.executions == nil || s.clock == nil {
		return errors.New("task poll scheduler dependencies are not configured")
	}
	workCtx := logcontext.WithBusiness(ctx, logcontext.Business{TaskRunID: claim.TaskRunID})
	timeout := s.config.ExecutionTimeout
	if !claim.DeadlineAt.IsZero() {
		remaining := claim.DeadlineAt.Sub(s.clock.Now())
		if remaining < timeout {
			timeout = remaining
		}
	}
	pollCtx, cancel := context.WithTimeout(workCtx, timeout)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.processClaim(pollCtx, claim) }()
	ticker := time.NewTicker(s.config.Heartbeat)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return NewClaimError(claim.TaskRunID, err)
		case <-ticker.C:
			now := s.clock.Now()
			won, err := s.schedules.RenewPollSchedule(pollCtx, claim, now, now.Add(s.config.Lease))
			if err != nil || !won {
				cancel()
				<-done
				return NewClaimError(claim.TaskRunID, errors.Join(err, errors.New("poll schedule lease lost")))
			}
		case <-pollCtx.Done():
			cancel()
			<-done
			return NewClaimError(claim.TaskRunID, pollCtx.Err())
		}
	}
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
	if run.RunType != s.runType {
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
		return s.processor.ProcessPollClaim(executionCtx, current, schedule)
	})
}
