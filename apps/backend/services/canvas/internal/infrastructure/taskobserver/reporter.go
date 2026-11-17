package taskobserver

import (
	"context"
	"fmt"

	"log/slog"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	"github.com/example/monorepo/canvas/internal/application/logcontext"
	applicationprojectstatistics "github.com/example/monorepo/canvas/internal/application/projectstatistics"
	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

type reporter struct {
	log *slog.Logger
}

func New(log *slog.Logger) applicationvideogeneration.TargetFailureReporter {
	return reporter{log: log}
}

func NewCanvasNodeCancellationFailureReporter(log *slog.Logger) applicationcanvas.CancellationFailureReporter {
	return reporter{log: log}
}

func NewCanvasNodeVisibilityFailureReporter(log *slog.Logger) applicationcanvas.VisibilityFailureReporter {
	return reporter{log: log}
}

func NewCanvasNodeFramePreviewFailureReporter(log *slog.Logger) applicationcanvas.FramePreviewFailureReporter {
	return reporter{log: log}
}

func NewGenerationFramePreviewFailureReporter(log *slog.Logger) applicationvideogeneration.FramePreviewFailureReporter {
	return reporter{log: log}
}

func NewCanvasFallbackCoverFailureReporter(log *slog.Logger) applicationcanvas.FallbackCoverFailureReporter {
	return reporter{log: log}
}

func NewProjectStatisticsFailureReporter(log *slog.Logger) applicationprojectstatistics.FailureReporter {
	return reporter{log: log}
}

func NewCanvasStatisticsFailureReporter(log *slog.Logger) applicationcanvas.CanvasStatisticsFailureReporter {
	return reporter{log: log}
}

func NewStoryboardAssetCatalogFailureReporter(log *slog.Logger) applicationcanvas.StoryboardAssetCatalogFailureReporter {
	return reporter{log: log}
}

func NewStoryboardCacheCleanupFailureReporter(log *slog.Logger) applicationcanvas.StoryboardCacheCleanupFailureReporter {
	return reporter{log: log}
}

func (r reporter) ReportTargetFailure(ctx context.Context, run domaintask.TaskRun, err error) {
	fields := append(logcontext.Fields(ctx),
		slog.String("task_run_id", run.ID),
		slog.String("run_type", string(run.RunType)),
		slog.String("subject_type", string(run.SubjectType)),
		slog.String("subject_id", run.SubjectID),
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

func (r reporter) ReportFramePreviewFailure(ctx context.Context, tenantID, sourceAssetID string, err error) {
	fields := append(logcontext.Fields(ctx),
		slog.String("tenant_id", tenantID),
		slog.String("asset_id", sourceAssetID),
	)
	platformlogger.Error(r.log, "frame asset delivery capability failed", err, fields...)
}

func (r reporter) ReportFallbackCoverFailure(ctx context.Context, tenantID, operation string, err error) {
	fields := append(logcontext.Fields(ctx),
		slog.String("operation", operation),
		slog.String("tenant_id", tenantID),
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
		fields = append(fields, slog.String("error_type", fmt.Sprintf("%T", err)))
	}
	r.log.LogAttrs(ctx, slog.LevelWarn, "storyboard asset catalog list failed; confirming without auto-attach", fields...)
}

func (r reporter) ReportStoryboardCacheCleanupFailure(ctx context.Context, operation string, err error) {
	fields := append(logcontext.Fields(ctx), slog.String("operation", operation))
	platformlogger.Error(r.log, "storyboard live cache cleanup failed", err, fields...)
}

// officialMaterializationReporter 独立于 reporter：后者的 Report 文案固定为分镜取消失败，
// 复用会打出与实际原因无关的日志。
type officialMaterializationReporter struct {
	log *slog.Logger
}

func NewOfficialMaterializationFailureReporter(
	log *slog.Logger,
) applicationresource.OfficialMaterializationFailureReporter {
	return officialMaterializationReporter{log: log}
}

func (r officialMaterializationReporter) Report(ctx context.Context, err error) {
	platformlogger.Error(r.log, "official resource materialization failed", err, logcontext.Fields(ctx)...)
}
