package officialasset

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	applicationofficialasset "github.com/example/monorepo/canvas/internal/application/officialasset"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainofficialasset "github.com/example/monorepo/canvas/internal/domain/officialasset"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *persistencetransaction.Store }

func NewRepository(db *persistencetransaction.Store) *Repository { return &Repository{db: db} }

func (r *Repository) Create(ctx context.Context, item domainofficialasset.OfficialAsset) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	err = r.db.Queries(ctx).InsertOfficialAsset(ctx, sqlc.InsertOfficialAssetParams{
		Slug:             row.Slug,
		TenantID:         row.TenantID,
		WorkspaceID:      row.WorkspaceID,
		WorkspaceKey:     row.WorkspaceKey,
		SourceAssetID:    row.SourceAssetID,
		SourceRevisionID: row.SourceRevisionID,
		InternalAssetID:  row.InternalAssetID,
		ResourceID:       row.ResourceID,
		ResourceAssetID:  row.ResourceAssetID,
		LongLiveStatus:   row.LongLiveStatus,
		FileSha256:       row.FileSha256,
		FileName:         row.FileName,
		MediaType:        row.MediaType,
		SizeBytes:        row.SizeBytes,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	})
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		return applicationofficialasset.ErrAlreadyExists
	}
	return err
}

func (r *Repository) Get(
	ctx context.Context, scope domainofficialasset.Scope, slug string,
) (domainofficialasset.OfficialAsset, error) {
	row, err := r.db.Queries(ctx).ReadOfficialAsset(ctx, sqlc.ReadOfficialAssetParams{
		TenantID:     scope.TenantID,
		WorkspaceKey: workspaceKey(scope.WorkspaceID),
		Slug:         slug,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainofficialasset.OfficialAsset{}, applicationofficialasset.ErrNotFound
	}
	if err != nil {
		return domainofficialasset.OfficialAsset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) GetByInternalAssetID(
	ctx context.Context, scope domainofficialasset.Scope, internalAssetID string,
) (domainofficialasset.OfficialAsset, error) {
	parsed, err := persistenceid.Parse(internalAssetID)
	if err != nil {
		return domainofficialasset.OfficialAsset{}, applicationofficialasset.ErrNotFound
	}
	row, err := r.db.Queries(ctx).ReadOfficialAssetByInternalID(ctx, sqlc.ReadOfficialAssetByInternalIDParams{
		TenantID:     scope.TenantID,
		WorkspaceKey: workspaceKey(scope.WorkspaceID),
		InternalID:   parsed.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainofficialasset.OfficialAsset{}, applicationofficialasset.ErrNotFound
	}
	if err != nil {
		return domainofficialasset.OfficialAsset{}, err
	}
	return domainFromRow(row), nil
}

func (r *Repository) Save(ctx context.Context, item domainofficialasset.OfficialAsset) error {
	row, err := rowFromDomain(item)
	if err != nil {
		return err
	}
	n, err := r.db.Queries(ctx).ModifyOfficialAsset(ctx, sqlc.ModifyOfficialAssetParams{
		InternalAssetID:  row.InternalAssetID,
		ResourceID:       row.ResourceID,
		ResourceAssetID:  row.ResourceAssetID,
		LongLiveStatus:   row.LongLiveStatus,
		SourceAssetID:    row.SourceAssetID,
		SourceRevisionID: row.SourceRevisionID,
		FileSha256:       row.FileSha256,
		FileName:         row.FileName,
		MediaType:        row.MediaType,
		SizeBytes:        row.SizeBytes,
		UpdatedAt:        row.UpdatedAt,
		TenantID:         row.TenantID,
		WorkspaceKey:     row.WorkspaceKey,
		Slug:             row.Slug,
	})
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		return applicationofficialasset.ErrInternalAssetConflict
	}
	if err == nil && n == 0 {
		return applicationofficialasset.ErrNotFound
	}
	return err
}

func (r *Repository) ListByScope(
	ctx context.Context, scope domainofficialasset.Scope,
) ([]domainofficialasset.OfficialAsset, error) {
	if !scope.Valid() {
		return nil, nil
	}
	rows, err := r.db.Queries(ctx).ReadOfficialAssets(ctx, sqlc.ReadOfficialAssetsParams{
		TenantID:     scope.TenantID,
		WorkspaceKey: workspaceKey(scope.WorkspaceID),
	})
	if err != nil {
		return nil, err
	}
	return domainsFromRows(rows), nil
}

func (r *Repository) ListByLongLiveStatus(
	ctx context.Context, scope domainofficialasset.Scope,
	status domainofficialasset.LongLiveStatus, limit int32,
) ([]domainofficialasset.OfficialAsset, error) {
	if !scope.Valid() || !status.Valid() || limit <= 0 {
		return nil, nil
	}
	rows, err := r.db.Queries(ctx).ReadOfficialAssetsByStatus(ctx, sqlc.ReadOfficialAssetsByStatusParams{
		TenantID:       scope.TenantID,
		WorkspaceKey:   workspaceKey(scope.WorkspaceID),
		LongLiveStatus: int16(status),
		PageSize:       limit,
	})
	if err != nil {
		return nil, err
	}
	return domainsFromRows(rows), nil
}

func (r *Repository) SoftDelete(
	ctx context.Context, scope domainofficialasset.Scope, slug string, deletedAtMilli int64,
) error {
	if deletedAtMilli <= 0 {
		return domainofficialasset.ErrInvalidOfficialAsset
	}
	n, err := r.db.Queries(ctx).RetireOfficialAsset(ctx, sqlc.RetireOfficialAssetParams{
		RetiredAt:    deletedAtMilli,
		UpdatedAt:    time.UnixMilli(deletedAtMilli).UTC(),
		TenantID:     scope.TenantID,
		WorkspaceKey: workspaceKey(scope.WorkspaceID),
		Slug:         slug,
	})
	if err == nil && n == 0 {
		return applicationofficialasset.ErrNotFound
	}
	return err
}

func workspaceKey(workspaceID *string) string {
	if workspaceID == nil {
		return ""
	}
	return *workspaceID
}

func rowFromDomain(item domainofficialasset.OfficialAsset) (sqlc.OfficialAsset, error) {
	internalAssetID, err := persistenceid.ParseOptional(item.InternalAssetID)
	if err != nil {
		return sqlc.OfficialAsset{}, fmt.Errorf("map official asset internal Asset ID: %w", err)
	}
	resourceID, err := persistenceid.ParseOptional(item.ResourceID)
	if err != nil {
		return sqlc.OfficialAsset{}, fmt.Errorf("map official asset Resource ID: %w", err)
	}
	resourceAssetID, err := persistenceid.ParseOptional(item.ResourceAssetID)
	if err != nil {
		return sqlc.OfficialAsset{}, fmt.Errorf("map official asset ResourceAsset ID: %w", err)
	}
	return sqlc.OfficialAsset{
		Slug:             item.Slug,
		TenantID:         item.Scope.TenantID,
		WorkspaceID:      cloneString(item.Scope.WorkspaceID),
		WorkspaceKey:     workspaceKey(item.Scope.WorkspaceID),
		InternalAssetID:  persistenceid.OptionalText(internalAssetID),
		ResourceID:       persistenceid.OptionalText(resourceID),
		ResourceAssetID:  persistenceid.OptionalText(resourceAssetID),
		LongLiveStatus:   int16(item.LongLiveStatus),
		SourceAssetID:    nullableString(item.SourceAssetID),
		SourceRevisionID: nullableString(item.SourceRevisionID),
		FileSha256:       nullableString(item.FileSHA256),
		FileName:         item.FileName,
		MediaType:        int16(item.MediaType),
		SizeBytes:        item.SizeBytes,
		CreatedAt:        item.CreatedAt,
		UpdatedAt:        item.UpdatedAt,
	}, nil
}

func domainFromRow(row sqlc.OfficialAsset) domainofficialasset.OfficialAsset {
	return domainofficialasset.OfficialAsset{
		Slug: row.Slug,
		Scope: domainofficialasset.Scope{
			TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		},
		SourceAssetID:    stringValue(row.SourceAssetID),
		SourceRevisionID: stringValue(row.SourceRevisionID),
		InternalAssetID:  stringValue(row.InternalAssetID),
		ResourceID:       stringValue(row.ResourceID),
		ResourceAssetID:  stringValue(row.ResourceAssetID),
		LongLiveStatus:   domainofficialasset.LongLiveStatus(row.LongLiveStatus),
		FileSHA256:       stringValue(row.FileSha256),
		FileName:         row.FileName,
		MediaType:        domainasset.MediaType(row.MediaType),
		SizeBytes:        row.SizeBytes,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func domainsFromRows(rows []sqlc.OfficialAsset) []domainofficialasset.OfficialAsset {
	items := make([]domainofficialasset.OfficialAsset, 0, len(rows))
	for _, row := range rows {
		items = append(items, domainFromRow(row))
	}
	return items
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

func (r *Repository) ListScopes(ctx context.Context) ([]domainofficialasset.Scope, error) {
	rows, err := r.db.Queries(ctx).ReadOfficialAssetScopes(ctx)
	if err != nil {
		return nil, err
	}
	scopes := make([]domainofficialasset.Scope, 0, len(rows))
	for _, row := range rows {
		scopes = append(scopes, domainofficialasset.Scope{
			TenantID: row.TenantID, WorkspaceID: cloneString(row.WorkspaceID),
		})
	}
	return scopes, nil

}
