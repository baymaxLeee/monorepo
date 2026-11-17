package projectcleanup

import (
	"context"

	"log/slog"

	"github.com/example/monorepo/canvas/internal/application/logcontext"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

type failureReporter struct {
	log *slog.Logger
}

func NewFailureReporter(log *slog.Logger) applicationproject.CleanupFailureReporter {
	return failureReporter{log: log}
}

func (r failureReporter) Report(ctx context.Context, err error) {
	platformlogger.Error(r.log, "project child cleanup failed", err, logcontext.Fields(ctx)...)
}
