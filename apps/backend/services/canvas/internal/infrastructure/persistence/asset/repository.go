package asset

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	applicationasset "github.com/example/monorepo/canvas/internal/application/asset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	scopelifecycle "github.com/example/monorepo/canvas/internal/infrastructure/persistence/scopelifecycle"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, item domainasset.Asset) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := scopelifecycle.LockActive(ctx, r.db, item.TenantID, item.WorkspaceID); err != nil {
			return err
		}
		if item.OwnerType != domainasset.OwnerOfficial {
			if err := NewOwnerResolver(r.db).ValidateForUpdate(ctx, applicationasset.Scope{TenantID: item.TenantID, WorkspaceID: item.WorkspaceID}, item.OwnerType, item.OwnerID); err != nil {
				return err
			}
		}
		return r.db.Queries(ctx).InsertOwnedAsset(ctx, sqlc.InsertOwnedAssetParams{
			ID:               row.ID,
			TenantID:         row.TenantID,
			WorkspaceID:      row.WorkspaceID,
			OwnerType:        row.OwnerType,
			OwnerID:          row.OwnerID,
			CreationKey:      row.CreationKey,
			SourceAssetID:    row.SourceAssetID,
			SourceRevisionID: row.SourceRevisionID,
			FileName:         row.FileName,
			MediaType:        row.MediaType,
			ContentType:      row.ContentType,
			SizeBytes:        row.SizeBytes,
			BillingClass:     row.BillingClass,
			CreatedBy:        row.CreatedBy,
			CreatedAt:        row.CreatedAt,
		})
	})
}

func (r *Repository) Get(ctx context.Context, scope applicationasset.Scope, assetID string) (domainasset.Asset, error) {
	return r.get(ctx, scope, assetID, false)
}

func (r *Repository) GetForUpdate(ctx context.Context, scope applicationasset.Scope, assetID string) (domainasset.Asset, error) {
	return r.get(ctx, scope, assetID, true)
}

func (r *Repository) get(ctx context.Context, scope applicationasset.Scope, assetID string, lock bool) (domainasset.Asset, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	var row sqlc.Asset
	if lock {
		row, err = r.db.Queries(ctx).LockOwnedAsset(ctx, sqlc.LockOwnedAssetParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ID:          id.String(),
		})
	} else {
		row, err = r.db.Queries(ctx).ReadOwnedAsset(ctx, sqlc.ReadOwnedAssetParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			ID:          id.String(),
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	if err != nil {
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) GetReferenced(
	ctx context.Context,
	scope applicationasset.Scope,
	owner applicationasset.ReferenceOwner,
	assetID string,
	lock bool,
) (domainasset.Asset, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil || !owner.Type.Valid() || owner.Key == "" {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	var row sqlc.Asset
	if lock {
		row, err = r.db.Queries(ctx).LockReferencedAsset(ctx, sqlc.LockReferencedAssetParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			OwnerType:   string(owner.Type),
			OwnerKey:    owner.Key,
			ID:          id.String(),
		})
	} else {
		row, err = r.db.Queries(ctx).ReadReferencedAsset(ctx, sqlc.ReadReferencedAssetParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			OwnerType:   string(owner.Type),
			OwnerKey:    owner.Key,
			ID:          id.String(),
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	if err != nil {
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) GetCommitted(ctx context.Context, scope applicationasset.Scope, assetID string) (domainasset.Asset, error) {
	id, err := persistenceid.Parse(assetID)
	if err != nil {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	row, err := r.db.CommittedQueries().ReadOwnedAssetUnscoped(ctx, sqlc.ReadOwnedAssetUnscopedParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		ID:          id.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	if err != nil {
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) GetByCreationKey(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
	creationKey string,
) (domainasset.Asset, error) {
	ownerUUID, err := persistenceid.Parse(ownerID)
	if err != nil {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadAssetForCreation(ctx, sqlc.ReadAssetForCreationParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		OwnerType:   int16(ownerType),
		OwnerID:     ownerUUID.String(),
		CreationKey: creationKey,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainasset.Asset{}, applicationasset.ErrNotFound
	}
	if err != nil {
		return domainasset.Asset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) BatchGet(ctx context.Context, scope applicationasset.Scope, assetIDs []string) ([]domainasset.Asset, error) {
	ids := persistenceid.ParseValidStrings(assetIDs)
	if len(ids) == 0 {
		return []domainasset.Asset{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadOwnedAssets(ctx, sqlc.ReadOwnedAssetsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	items := make([]domainasset.Asset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) BatchGetReferenced(
	ctx context.Context,
	scope applicationasset.Scope,
	owner applicationasset.ReferenceOwner,
	assetIDs []string,
) ([]domainasset.Asset, error) {
	ids := persistenceid.ParseValidStrings(assetIDs)
	if len(ids) == 0 || !owner.Type.Valid() || owner.Key == "" {
		return []domainasset.Asset{}, nil
	}
	rows, err := r.db.Queries(ctx).ReadReferencedAssets(ctx, sqlc.ReadReferencedAssetsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		OwnerType:   string(owner.Type),
		OwnerKey:    owner.Key,
		Ids:         ids,
	})
	if err != nil {
		return nil, err
	}
	items := make([]domainasset.Asset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) ListByOwner(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
	limit int,
) ([]domainasset.Asset, error) {
	if limit < 1 {
		return []domainasset.Asset{}, nil
	}
	ownerUUID, err := persistenceid.Parse(ownerID)
	if err != nil {
		return nil, applicationasset.ErrNotFound
	}
	rows, err := r.db.Queries(ctx).ListOwnedAssets(ctx, sqlc.ListOwnedAssetsParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		OwnerType:   int16(ownerType),
		OwnerID:     ownerUUID.String(),
		PageSize:    int32(limit),
	})
	if err != nil {
		return nil, err
	}
	items := make([]domainasset.Asset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items, nil
}

func (r *Repository) BatchGetReferencedAssets(
	ctx context.Context,
	scope applicationasset.Scope,
	references []applicationasset.AssetReference,
) ([]applicationasset.ReferencedAsset, error) {
	var ids, types, keys []string
	for _, ref := range references {
		id, err := persistenceid.Parse(ref.AssetID)
		if err != nil || !ref.Owner.Type.Valid() || ref.Owner.Key == "" {
			continue
		}
		ids = append(ids, id.String())
		types = append(types, string(ref.Owner.Type))
		keys = append(keys, ref.Owner.Key)
	}
	if len(ids) == 0 {
		return []applicationasset.ReferencedAsset{}, nil
	}
	rows, err := r.db.Queries(ctx).MatchAssetReferences(ctx, sqlc.MatchAssetReferencesParams{
		Ids:         ids,
		Types:       types,
		Keys:        keys,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	items := make([]applicationasset.ReferencedAsset, 0, len(rows))
	for _, row := range rows {
		items = append(items, applicationasset.ReferencedAsset{Reference: applicationasset.AssetReference{Owner: applicationasset.ReferenceOwner{Type: applicationasset.ReferenceOwnerType(row.OwnerType), Key: row.OwnerKey}, AssetID: row.Asset.ID}, Asset: domainFromRow(row.Asset)})
	}
	return items, nil
}

func (r *Repository) DeleteByOwner(
	ctx context.Context,
	scope applicationasset.Scope,
	ownerType domainasset.OwnerType,
	ownerID string,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	id, err := persistenceid.Parse(ownerID)
	if err != nil {
		return nil, applicationasset.ErrNotFound
	}
	owner := id.String()
	return r.retire(ctx, sqlc.LockAssetsForRetirementParams{
		TenantID:      scope.TenantID,
		AllWorkspaces: false,
		WorkspaceID:   scope.WorkspaceID,
		OwnerID:       &owner,
		OwnerType:     int16(ownerType),
	}, now)
}

func (r *Repository) DeleteByTenant(
	ctx context.Context,
	tenantID string,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	return r.retire(ctx, sqlc.LockAssetsForRetirementParams{
		TenantID:      tenantID,
		AllWorkspaces: true,
		WorkspaceID:   nil,
		OwnerID:       nil,
		OwnerType:     0,
	}, now)
}

func (r *Repository) DeleteByWorkspace(
	ctx context.Context,
	tenantID string,
	workspaceID string,
	now time.Time,
) ([]applicationasset.RetiredAsset, error) {
	return r.retire(ctx, sqlc.LockAssetsForRetirementParams{
		TenantID:      tenantID,
		AllWorkspaces: false,
		WorkspaceID:   &workspaceID,
		OwnerID:       nil,
		OwnerType:     0,
	}, now)
}

func (r *Repository) retire(ctx context.Context, scope sqlc.LockAssetsForRetirementParams, now time.Time) ([]applicationasset.RetiredAsset, error) {
	deleted := []applicationasset.RetiredAsset{}
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		rows, err := r.db.Queries(ctx).LockAssetsForRetirement(ctx, scope)
		if err != nil {
			return err
		}
		for _, row := range rows {
			n, err := r.db.Queries(ctx).RetireOwnedAsset(ctx, sqlc.RetireOwnedAssetParams{
				RetiredAt: now.UnixMilli(),
				ID:        row.ID,
			})
			if err != nil {
				return err
			}
			if n == 0 {
				continue
			}
			if err := r.db.Queries(ctx).RetireAssetReferences(ctx, sqlc.RetireAssetReferencesParams{
				RetiredAt: now.UnixMilli(),
				UpdatedAt: now,
				AssetID:   row.ID,
			}); err != nil {
				return err
			}
			deleted = append(deleted, retiredAssetFromRow(row))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

func retiredAssetFromRow(row sqlc.Asset) applicationasset.RetiredAsset {
	return applicationasset.RetiredAsset{
		AssetID:          row.ID,
		TenantID:         row.TenantID,
		WorkspaceID:      cloneString(row.WorkspaceID),
		SourceAssetID:    row.SourceAssetID,
		SourceRevisionID: row.SourceRevisionID,
	}
}

func rowFromDomain(item domainasset.Asset) (sqlc.Asset, error) {
	id, err := persistenceid.Parse(item.ID)
	if err != nil {
		return sqlc.Asset{}, fmt.Errorf("map Asset ID: %w", err)
	}
	ownerID, err := persistenceid.Parse(item.OwnerID)
	if err != nil {
		return sqlc.Asset{}, fmt.Errorf("map Asset owner ID: %w", err)
	}
	return sqlc.Asset{
		ID: id.String(), TenantID: item.TenantID, WorkspaceID: cloneString(item.WorkspaceID),
		OwnerType: int16(item.OwnerType), OwnerID: ownerID.String(), CreationKey: nullableString(item.CreationKey),
		SourceAssetID: item.SourceAssetID, SourceRevisionID: item.SourceRevisionID,
		FileName: item.FileName, MediaType: int16(item.MediaType), ContentType: item.ContentType,
		SizeBytes: item.SizeBytes, BillingClass: string(item.BillingClass),
		CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt,
	}, nil
}

func domainFromRow(row sqlc.Asset) domainasset.Asset {
	return domainasset.Asset{
		ID: row.ID, TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		OwnerType: domainasset.OwnerType(row.OwnerType), OwnerID: row.OwnerID,
		CreationKey: stringValue(row.CreationKey), SourceAssetID: row.SourceAssetID, SourceRevisionID: row.SourceRevisionID,
		FileName: row.FileName, MediaType: domainasset.MediaType(row.MediaType), ContentType: row.ContentType,
		SizeBytes: row.SizeBytes, BillingClass: domainasset.BillingClass(row.BillingClass),
		CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt,
	}
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
