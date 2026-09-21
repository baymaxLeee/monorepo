package canvasarchive

import (
	"context"
	"time"

	applicationtask "github.com/example/monorepo/canvas/internal/server/application/task"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
)

type AsyncExecutionStarter struct {
	exports      LifecycleStore
	runs         TaskRunLifecycleStore
	transactions TransactionManager
}

func NewAsyncExecutionStarter(
	exports LifecycleStore,
	runs TaskRunLifecycleStore,
	transactions TransactionManager,
) *AsyncExecutionStarter {
	return &AsyncExecutionStarter{exports: exports, runs: runs, transactions: transactions}
}

func (*AsyncExecutionStarter) RunType() domaintask.RunType {
	return domaintask.RunTypeCanvasVideoArchiveExport
}

func (starter *AsyncExecutionStarter) MarkStarted(
	ctx context.Context,
	run domaintask.TaskRun,
	_ domaintask.AsyncDispatch,
	now time.Time,
) error {
	startedAt := now
	return starter.transactions.WithinTransaction(ctx, func(txCtx context.Context) error {
		detailUpdated, err := starter.exports.UpdateLifecycle(
			txCtx,
			run.ID,
			domaintask.StatusQueued,
			LifecycleUpdate{Status: domaintask.StatusRunning, StartedAt: &startedAt},
			now,
		)
		if err != nil {
			return err
		}
		if !detailUpdated {
			return errLifecycleCASLost
		}
		runUpdated, err := starter.runs.UpdateTaskRun(txCtx, run, applicationtask.TaskRunUpdate{
			Status: domaintask.StatusRunning, StartedAt: &startedAt,
		}, now)
		if err != nil {
			return err
		}
		if !runUpdated {
			return errLifecycleCASLost
		}
		return nil
	})
}
