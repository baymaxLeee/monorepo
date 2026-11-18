package resource

import (
	"context"

	applicationresource "github.com/example/monorepo/canvas/internal/application/resource"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type ProjectResolver struct{ store *transaction.Store }

func NewProjectResolver(store *transaction.Store) *ProjectResolver {
	return &ProjectResolver{store: store}
}

func (r *ProjectResolver) Validate(ctx context.Context, scope applicationresource.Scope, projectID string) error {
	id, err := persistenceid.Parse(projectID)
	if err != nil {
		return applicationresource.ErrProjectNotFound
	}
	exists, err := r.store.Queries(ctx).ActiveProjectExists(ctx, sqlc.ActiveProjectExistsParams{ProjectID: id.String(), TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID})
	if err != nil {
		return err
	}
	if !exists {
		return applicationresource.ErrProjectNotFound
	}
	return nil
}
