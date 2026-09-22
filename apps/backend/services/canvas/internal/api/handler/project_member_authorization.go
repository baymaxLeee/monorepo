package http

import (
	"context"
	"errors"

	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

func requireProjectAccess(
	ctx context.Context,
	checker applicationprojectaccess.Checker,
	workspaceID *string,
	projectID string,
	access applicationprojectaccess.Access,
	notFoundCode errno.ErrorCode,
) error {
	if checker == nil {
		return errno.New(errno.ErrConfigurationError)
	}
	metadata, _ := topcontext.MetadataFromContext(ctx)
	err := checker.Check(ctx, metadata.TenantID, nullableWorkspaceID(workspaceID), metadata.UserID, projectID, access)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, applicationprojectaccess.ErrForbidden):
		return errno.Wrap(errno.ErrForbidden, err)
	case errors.Is(err, applicationprojectaccess.ErrProjectNotFound):
		return errno.Wrap(notFoundCode, err)
	case errors.Is(err, applicationprojectaccess.ErrPermissionLookup):
		return errno.ExternalDependency(err)
	default:
		return errno.Ensure(errno.ErrPersistenceError, err)
	}
}
