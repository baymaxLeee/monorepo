package taskobserver

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

type reporter struct {
	log *zap.Logger
}

func New(log *zap.Logger) applicationvideogeneration.TargetFailureReporter {
	return reporter{log: log}
}

func NewCanvasNodeCancellationFailureReporter(log *zap.Logger) applicationcanvas.CancellationFailureReporter {
	return reporter{log: log}
}

func NewCanvasNodeVisibilityFailureReporter(log *zap.Logger) applicationcanvas.VisibilityFailureReporter {
	return reporter{log: log}
}

func NewCanvasNodeFramePreviewFailureReporter(log *zap.Logger) applicationcanvas.FramePreviewFailureReporter {
	return reporter{log: log}
}

func NewGenerationFramePreviewFailureReporter(log *zap.Logger) applicationvideogeneration.FramePreviewFailureReporter {
	return reporter{log: log}
}

func NewCanvasFallbackCoverFailureReporter(log *zap.Logger) applicationcanvas.FallbackCoverFailureReporter {
	return reporter{log: log}
}

func NewProjectStatisticsFailureReporter(log *zap.Logger) applicationprojectstatistics.FailureReporter {
	return reporter{log: log}
}

func NewCanvasStatisticsFailureReporter(log *zap.Logger) applicationcanvas.CanvasStatisticsFailureReporter {
	return reporter{log: log}
}

func NewStoryboardAssetCatalogFailureReporter(log *zap.Logger) applicationcanvas.StoryboardAssetCatalogFailureReporter {
	return reporter{log: log}
}

func NewStoryboardCacheCleanupFailureReporter(log *zap.Logger) applicationcanvas.StoryboardCacheCleanupFailureReporter {
	return reporter{log: log}
}

func (r reporter) ReportTargetFailure(ctx context.Context, run domaintask.TaskRun, err error) {
	fields := append(logcontext.Fields(ctx),
		zap.String("task_run_id", run.ID),
		zap.String("run_type", string(run.RunType)),
		zap.String("subject_type", string(run.SubjectType)),
		zap.String("subject_id", run.SubjectID),
	)
	platformlogger.Error(r.log,
		"generation target state is missing",
		err,
		fields...,
	)
}

func (r reporter) Report(ctx context.Context, err error) {
	platformlogger.Error(r.log, "revoked canvasnode generation cancellation failed", err, logcontext.Fields(ctx)...)
}

func (r reporter) ReportVisibilityFailure(ctx context.Context, err error) {
	platformlogger.Error(r.log, "deleted canvasnode task visibility update failed", err, logcontext.Fields(ctx)...)
}

func (r reporter) ReportFramePreviewFailure(ctx context.Context, tenantID, artifactID string, err error) {
	fields := append(logcontext.Fields(ctx),
		zap.String("tenant_id", tenantID),
		zap.String("artifact_id", artifactID),
	)
	platformlogger.Error(r.log, "frame artifact presign failed", err, fields...)
}

func (r reporter) ReportFallbackCoverFailure(ctx context.Context, tenantID, operation string, err error) {
	fields := append(logcontext.Fields(ctx),
		zap.String("operation", operation),
		zap.String("tenant_id", tenantID),
	)
	platformlogger.Error(r.log, "canvas fallback cover enrichment failed", err, fields...)
}

func (r reporter) ReportProjectStatisticsFailure(ctx context.Context, err error) {
	platformlogger.Error(r.log, "project statistics refresh failed", err, logcontext.Fields(ctx)...)
}

func (r reporter) ReportCanvasStatisticsFailure(ctx context.Context, err error) {
	platformlogger.Error(r.log, "canvas statistics refresh failed", err, logcontext.Fields(ctx)...)
}

func (r reporter) ReportStoryboardAssetCatalogFailure(ctx context.Context, err error) {
	if r.log == nil {
		return
	}
	fields := logcontext.Fields(ctx)
	if err != nil {
		fields = append(fields, zap.String("error_type", fmt.Sprintf("%T", err)))
	}
	r.log.Warn("storyboard asset catalog list failed; confirming without auto-attach", fields...)
}

func (r reporter) ReportStoryboardCacheCleanupFailure(ctx context.Context, operation string, err error) {
	fields := append(logcontext.Fields(ctx), zap.String("operation", operation))
	platformlogger.Error(r.log, "storyboard live cache cleanup failed", err, fields...)
}

// officialMaterializationReporter 独立于 reporter：后者的 Report 文案固定为分镜取消失败，
// 复用会打出与实际原因无关的日志。
type officialMaterializationReporter struct {
	log *zap.Logger
}

func NewOfficialMaterializationFailureReporter(
	log *zap.Logger,
) applicationresource.OfficialMaterializationFailureReporter {
	return officialMaterializationReporter{log: log}
}

func (r officialMaterializationReporter) Report(ctx context.Context, err error) {
	platformlogger.Error(r.log, "official resource materialization failed", err, logcontext.Fields(ctx)...)
}
