package task

import (
	"context"

	domain "github.com/example/monorepo/canvas/internal/domain/task"
)

// CanExecuteTaskRun preserves compatibility with in-memory/test stores while
// allowing the production repository to fence execution on the complete
// active parent chain.
func CanExecuteTaskRun(ctx context.Context, reader TaskRunReader, run domain.TaskRun) (bool, error) {
	admission, ok := reader.(TaskRunAdmission)
	if !ok {
		return true, nil
	}
	return admission.CanExecuteTaskRun(ctx, run)
}
