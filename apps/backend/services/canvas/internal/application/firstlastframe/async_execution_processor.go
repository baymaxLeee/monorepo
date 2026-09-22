package firstlastframe

import (
	"context"
	"time"

	applicationtask "github.com/example/monorepo/canvas/internal/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

type AsyncExecutionStarter struct {
	tasks        TaskStore
	transactions TransactionManager
}

func NewAsyncExecutionStarter(tasks TaskStore, transactions TransactionManager) *AsyncExecutionStarter {
	return &AsyncExecutionStarter{tasks: tasks, transactions: transactions}
}

func (*AsyncExecutionStarter) RunType() domaintask.RunType {
	return domaintask.RunTypeCanvasNodeVideoFirstLastFrameExtraction
}

func (starter *AsyncExecutionStarter) MarkStarted(
	ctx context.Context,
	run domaintask.TaskRun,
	_ domaintask.AsyncDispatch,
	now time.Time,
) error {
	startedAt := now
	return starter.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		updated, err := starter.tasks.UpdateTaskRun(txCtx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusRunning, StartedAt: &startedAt,
		}, now)
		if err != nil {
			return err
		}
		if !updated {
			return ErrLifecycleCASLost
		}
		return nil
	})
}
