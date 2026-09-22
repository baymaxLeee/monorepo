package task

import (
	"context"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

func CanExecuteTaskRun(ctx context.Context, reader TaskRunReader, run domain.TaskRun) (bool, error) {
	return reader.CanExecuteTaskRun(ctx, run)
}
