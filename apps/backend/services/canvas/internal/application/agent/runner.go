package agent

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

type Syncer interface {
	Sync(context.Context) error
}

type SyncRunner struct {
	enabled          bool
	retryInterval    time.Duration
	operationTimeout time.Duration
	syncer           Syncer
	log              *zap.Logger
}

func NewSyncRunner(enabled bool, retryInterval, operationTimeout time.Duration, syncer Syncer, log *zap.Logger) *SyncRunner {
	if log == nil {
		log = zap.NewNop()
	}
	return &SyncRunner{
		enabled: enabled, retryInterval: retryInterval, operationTimeout: operationTimeout,
		syncer: syncer, log: log,
	}
}

func (r *SyncRunner) Run(ctx context.Context) {
	if !r.enabled {
		return
	}
	for {
		workCtx := trace.ContextWithSpanContext(ctx, trace.SpanContextFromContext(ctx))
		attemptContext, cancel := context.WithTimeout(workCtx, r.operationTimeout)
		err := r.syncer.Sync(attemptContext)
		cancel()
		if err == nil {
			r.log.Info("Agent skills synchronized", logcontext.Fields(workCtx)...)
			return
		}
		platformlogger.Error(r.log, "Agent skill synchronization failed", err, logcontext.Fields(workCtx)...)
		timer := time.NewTimer(r.retryInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
	}
}
