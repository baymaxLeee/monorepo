// Package logcontext maps trusted request metadata to safe structured log fields.
package logcontext

import (
	"context"

	"log/slog"

	"github.com/example/monorepo/canvas/internal/application/requestcontext"
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

// Fields intentionally excludes raw headers and signing metadata.
func Fields(ctx context.Context) []slog.Attr {
	var metadata requestcontext.Metadata
	var business Business
	var hasBusiness bool
	if ctx != nil {
		metadata, _ = requestcontext.MetadataFromContext(ctx)
		business, hasBusiness = ctx.Value(businessContextKey{}).(Business)
	}
	tenantID := metadata.TenantID
	if hasBusiness && business.TenantID != "" {
		tenantID = business.TenantID
	}
	fields := []slog.Attr{
		slog.String("tenant_id", tenantID),
		slog.String("user_id", metadata.UserID),
		slog.String("service", metadata.Service),
		slog.String("action", metadata.Action),
		slog.String("version", metadata.Version),
		slog.String("identity_type", metadata.IdentityType),
	}
	if hasBusiness {
		fields = append(fields,
			slog.String("workspace_id", optionalString(business.WorkspaceID)),
			slog.String("project_id", business.ProjectID),
			slog.String("resource_id", business.ResourceID),
			slog.String("cleanup_stage", business.CleanupStage),
			slog.String("canvas_id", business.CanvasID),
			slog.String("node_id", business.NodeID),
			slog.String("task_run_id", business.TaskRunID),
		)
		if len(business.NodeIDs) > 0 {
			fields = append(fields, slog.Any("node_ids", business.NodeIDs))
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
