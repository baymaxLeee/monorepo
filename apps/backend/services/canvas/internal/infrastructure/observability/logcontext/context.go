// Package logcontext maps trusted request metadata to safe structured log fields.
package logcontext

import (
	"context"

	"go.uber.org/zap"

	"github.com/example/monorepo/canvas/internal/api/requestcontext"
)

type businessContextKey struct{}

type Business struct {
	TenantID     string
	WorkspaceID  *string
	ProjectID    string
	ResourceID   string
	CleanupStage string
	CanvasID     string
	NodeID       string
	TaskRunID    string
	NodeIDs      []string
}

func WithBusiness(ctx context.Context, business Business) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, businessContextKey{}, business)
}

// Fields intentionally excludes the authorization filter, raw headers, and
// signing metadata even when they are present in the request context.
func Fields(ctx context.Context) []zap.Field {
	var metadata topcontext.Metadata
	var business Business
	var hasBusiness bool
	if ctx != nil {
		metadata, _ = topcontext.MetadataFromContext(ctx)
		business, hasBusiness = ctx.Value(businessContextKey{}).(Business)
	}
	tenantID := metadata.TenantID
	if hasBusiness && business.TenantID != "" {
		tenantID = business.TenantID
	}
	fields := []zap.Field{
		zap.String("tenant_id", tenantID),
		zap.String("user_id", metadata.UserID),
		zap.String("service", metadata.Service),
		zap.String("action", metadata.Action),
		zap.String("version", metadata.Version),
		zap.String("region", metadata.Region),
		zap.String("identity_type", metadata.IdentityType),
		zap.String("real_ip", metadata.RealIP),
	}
	if hasBusiness {
		fields = append(fields,
			zap.String("workspace_id", optionalString(business.WorkspaceID)),
			zap.String("project_id", business.ProjectID),
			zap.String("resource_id", business.ResourceID),
			zap.String("cleanup_stage", business.CleanupStage),
			zap.String("canvas_id", business.CanvasID),
			zap.String("node_id", business.NodeID),
			zap.String("task_run_id", business.TaskRunID),
		)
		if len(business.NodeIDs) > 0 {
			fields = append(fields, zap.Strings("node_ids", business.NodeIDs))
		}
	}
	return fields
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
