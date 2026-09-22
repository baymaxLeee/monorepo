package requestcontext

import "context"

type contextKey struct{}

// Metadata contains trusted request metadata forwarded by Gateway.
type Metadata struct {
	RequestID    string
	TenantID     string
	UserID       string
	WorkspaceID  string
	Service      string
	Action       string
	Version      string
	IdentityType string
}

func WithMetadata(ctx context.Context, metadata Metadata) context.Context {
	return context.WithValue(ctx, contextKey{}, metadata)
}

func MetadataFromContext(ctx context.Context) (Metadata, bool) {
	if ctx == nil {
		return Metadata{}, false
	}
	metadata, ok := ctx.Value(contextKey{}).(Metadata)
	return metadata, ok
}

func RequestIDFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.RequestID })
}

func TenantIDFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.TenantID })
}

func UserIDFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.UserID })
}

func WorkspaceIDFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.WorkspaceID })
}

func ServiceFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.Service })
}

func ActionFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.Action })
}

func VersionFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.Version })
}

func IdentityTypeFromContext(ctx context.Context) (string, bool) {
	return valueFromContext(ctx, func(metadata Metadata) string { return metadata.IdentityType })
}

func valueFromContext(ctx context.Context, selectValue func(Metadata) string) (string, bool) {
	metadata, ok := MetadataFromContext(ctx)
	if !ok {
		return "", false
	}
	value := selectValue(metadata)
	return value, value != ""
}
