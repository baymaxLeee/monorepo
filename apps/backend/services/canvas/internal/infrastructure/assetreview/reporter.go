package assetreview

import (
	"context"

	"go.uber.org/zap"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/observability/logcontext"
	platformlogger "github.com/example/monorepo/canvas/pkg/platform/logger"
)

type CleanupFailureReporter struct{ log *zap.Logger }

func NewCleanupFailureReporter(log *zap.Logger) *CleanupFailureReporter {
	return &CleanupFailureReporter{log: log}
}

func (reporter *CleanupFailureReporter) ReportReviewCleanupFailure(ctx context.Context, item applicationasset.GarbageCollectionAsset, err error) {
	fields := append(logcontext.Fields(ctx),
		zap.String("asset_id", item.AssetID),
		zap.String("tenant_id", item.TenantID),
		zap.String("artifact_id", item.ArtifactID),
	)
	if item.WorkspaceID != nil {
		fields = append(fields, zap.String("workspace_id", *item.WorkspaceID))
	}
	platformlogger.Error(reporter.log, "reviewed asset cleanup Outbox preparation failed", err, fields...)
}

func (reporter *CleanupFailureReporter) ReportAssetGroupCleanupFailure(ctx context.Context, operation, packageID string, err error) {
	platformlogger.Error(
		reporter.log,
		"Ark asset group cleanup failed",
		err,
		append(logcontext.Fields(ctx), zap.String("operation", operation), zap.String("package_id", packageID))...,
	)
}
