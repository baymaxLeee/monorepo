package asset

import (
	"context"
	"time"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
)

func validReferenceIDs(assetIDs []string) ([]string, error) {
	if len(assetIDs) == 0 || len(assetIDs) > 100 {
		return nil, applicationasset.ErrInvalidReferenceInput
	}
	ids := make([]string, 0, len(assetIDs))
	seen := make(map[persistenceid.UUID]struct{}, len(assetIDs))
	for _, value := range assetIDs {
		id, err := persistenceid.Parse(value)
		if err != nil {
			return nil, applicationasset.ErrInvalidReferenceInput
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id.String())
	}
	return ids, nil
}

func (r *Repository) AcquireReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	owner applicationasset.ReferenceOwner,
	assetIDs []string,
	createdAt time.Time,
) error {
	ids, err := validReferenceIDs(assetIDs)
	if err != nil || !owner.Type.Valid() || owner.Key == "" || createdAt.IsZero() {
		return applicationasset.ErrInvalidReferenceInput
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		rows, err := r.db.Queries(ctx).LockAssetsForReferences(ctx, sqlc.LockAssetsForReferencesParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			Ids:         ids,
		})
		if err != nil {
			return err
		}
		if len(rows) != len(ids) {
			return applicationasset.ErrNotFound
		}
		for _, id := range ids {
			if err := r.db.Queries(ctx).AcquireAssetReference(ctx, sqlc.AcquireAssetReferenceParams{
				AssetID:   id,
				OwnerType: string(owner.Type),
				OwnerKey:  owner.Key,
				CreatedAt: createdAt,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ReleaseReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	owner applicationasset.ReferenceOwner,
	assetIDs []string,
) error {
	ids, err := validReferenceIDs(assetIDs)
	if err != nil || !owner.Type.Valid() || owner.Key == "" {
		return applicationasset.ErrInvalidReferenceInput
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		now := time.Now().UTC()
		return r.db.Queries(ctx).ReleaseScopedAssetReferences(ctx, sqlc.ReleaseScopedAssetReferencesParams{
			RetiredAt:   now.UnixMilli(),
			UpdatedAt:   now,
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			OwnerType:   string(owner.Type),
			OwnerKey:    owner.Key,
			AllAssets:   false,
			Ids:         ids,
		})
	})
}

func (r *Repository) ReleaseOwnerReferences(
	ctx context.Context,
	scope applicationasset.ReferenceScope,
	owner applicationasset.ReferenceOwner,
) error {
	if !owner.Type.Valid() || owner.Key == "" {
		return applicationasset.ErrInvalidReferenceInput
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		now := time.Now().UTC()
		return r.db.Queries(ctx).ReleaseScopedAssetReferences(ctx, sqlc.ReleaseScopedAssetReferencesParams{
			RetiredAt:   now.UnixMilli(),
			UpdatedAt:   now,
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			OwnerType:   string(owner.Type),
			OwnerKey:    owner.Key,
			AllAssets:   true,
			Ids:         nil,
		})
	})
}
