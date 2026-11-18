package asset

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type OwnerResolver struct{ db *persistencetransaction.Store }

func NewOwnerResolver(db *persistencetransaction.Store) *OwnerResolver { return &OwnerResolver{db: db} }
func (r *OwnerResolver) Validate(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
) error {
	return r.validate(ctx, scope, ownerType, ownerID, false)
}

func (r *OwnerResolver) ValidateForUpdate(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
) error {
	return r.validate(ctx, scope, ownerType, ownerID, true)
}

func (r *OwnerResolver) validate(ctx context.Context, scope applicationasset.Scope, ownerType domainasset.OwnerType, ownerID string, lock bool) error {
	id, err := persistenceid.Parse(ownerID)
	if err != nil {
		return applicationasset.ErrOwnerNotFound
	}
	switch ownerType {
	case domainasset.OwnerProject:
		if lock {
			_, err = r.db.Queries(ctx).LockScopedProject(ctx, sqlc.LockScopedProjectParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				ID:          id.String(),
			})
		} else {
			_, err = r.db.Queries(ctx).FindScopedProject(ctx, sqlc.FindScopedProjectParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				ID:          id.String(),
			})
		}
	case domainasset.OwnerResource:
		if lock {
			_, err = r.db.Queries(ctx).LockAssetResourceOwner(ctx, sqlc.LockAssetResourceOwnerParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				ID:          id.String(),
			})
		} else {
			_, err = r.db.Queries(ctx).FindAssetResourceOwner(ctx, sqlc.FindAssetResourceOwnerParams{
				TenantID:    scope.TenantID,
				WorkspaceID: scope.WorkspaceID,
				ID:          id.String(),
			})
		}
	default:
		return applicationasset.ErrOwnerNotFound
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return applicationasset.ErrOwnerNotFound
	}
	return err
}
