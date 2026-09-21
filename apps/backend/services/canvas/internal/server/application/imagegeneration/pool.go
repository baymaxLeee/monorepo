package imagegeneration

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
	platformtracecontext "github.com/example/monorepo/canvas/pkg/platform/tracecontext"
)

const (
	imagePoolClaimLease = 2 * time.Minute
	imagePoolHeartbeat  = time.Minute
	imagePoolTimeout    = 30 * time.Minute
)

type PoolTaskStore interface {
	ClaimDueImageGenerationPollSchedules(context.Context, time.Time, time.Time, int) ([]domaintask.PollSchedule, error)
	RenewPollSchedule(context.Context, domaintask.PollSchedule, time.Time, time.Time) (bool, error)
	GetTaskRun(context.Context, string) (domaintask.TaskRun, error)
	CompletePollSchedule(context.Context, domaintask.PollSchedule) (bool, error)
}

type Pool struct {
	tasks      PoolTaskStore
	processor  *Processor
	executions *applicationtask.ActiveExecutions
	clock      Clock
}

func NewPool(tasks PoolTaskStore, processor *Processor, executions *applicationtask.ActiveExecutions, clock Clock) *Pool {
	return &Pool{tasks: tasks, processor: processor, executions: executions, clock: clock}
}

func (p *Pool) Claim(ctx context.Context, limit int) ([]domaintask.PollSchedule, error) {
	if p == nil || p.tasks == nil || p.clock == nil {
		return nil, errors.New("image generation pool claim dependencies are not configured")
	}
	if limit <= 0 {
		return nil, nil
	}
	now := p.clock.Now()
	return p.tasks.ClaimDueImageGenerationPollSchedules(ctx, now, now.Add(imagePoolClaimLease), limit)
}

func (p *Pool) ProcessClaim(ctx context.Context, claim domaintask.PollSchedule) error {
	if p == nil || p.tasks == nil || p.processor == nil || p.executions == nil || p.clock == nil {
		return errors.New("image generation pool execution dependencies are not configured")
	}
	workCtx := trace.ContextWithSpanContext(ctx, trace.SpanContextFromContext(ctx))
	workCtx = logcontext.WithBusiness(workCtx, logcontext.Business{TaskRunID: claim.TaskRunID})
	return platformtracecontext.WrapError(workCtx, p.processClaim(workCtx, claim, p.clock.Now()))
}

func (p *Pool) processClaim(ctx context.Context, claim domaintask.PollSchedule, now time.Time) error {
	run, err := p.tasks.GetTaskRun(ctx, claim.TaskRunID)
	if err != nil {
		return err
	}
	if run.Terminal() {
		_, err = p.tasks.CompletePollSchedule(ctx, claim)
		return err
	}
	allowed, err := applicationtask.CanExecuteTaskRun(ctx, p.tasks, run)
	if err != nil {
		return err
	}
	if !allowed {
		_, err = p.tasks.CompletePollSchedule(ctx, claim)
		return err
	}
	if !claim.DeadlineAt.IsZero() && !now.Before(claim.DeadlineAt) {
		return p.processor.ProcessPollClaim(context.WithoutCancel(ctx), run, claim)
	}
	return p.executeClaim(ctx, run, claim)
}

func (p *Pool) executeClaim(parent context.Context, run domaintask.TaskRun, claim domaintask.PollSchedule) error {
	deadline := p.clock.Now().Add(imagePoolTimeout)
	if !claim.DeadlineAt.IsZero() && claim.DeadlineAt.Before(deadline) {
		deadline = claim.DeadlineAt
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- p.executions.Run(ctx, run.ID, func(executionCtx context.Context) error {
			current, err := p.tasks.GetTaskRun(executionCtx, run.ID)
			if err != nil || current.Terminal() {
				return err
			}
			allowed, admissionErr := applicationtask.CanExecuteTaskRun(executionCtx, p.tasks, current)
			if admissionErr != nil || !allowed {
				return admissionErr
			}
			return p.processor.ProcessPollClaim(executionCtx, current, claim)
		})
	}()
	ticker := time.NewTicker(imagePoolHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			return err
		case <-ticker.C:
			now := p.clock.Now()
			won, err := p.tasks.RenewPollSchedule(ctx, claim, now, now.Add(imagePoolClaimLease))
			if err != nil || !won {
				cancel()
				<-done
				return errors.Join(err, errors.New("image generation pool lease lost"))
			}
		case <-ctx.Done():
			<-done
			return ctx.Err()
		}
	}
}
