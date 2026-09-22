package projectcleanup

import (
	"context"

	"go.uber.org/zap"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

type failureReporter struct {
	log *zap.Logger
}

func NewFailureReporter(log *zap.Logger) applicationproject.CleanupFailureReporter {
	return failureReporter{log: log}
}

func (r failureReporter) Report(ctx context.Context, err error) {
	platformlogger.Error(r.log, "project child cleanup failed", err, logcontext.Fields(ctx)...)
}
