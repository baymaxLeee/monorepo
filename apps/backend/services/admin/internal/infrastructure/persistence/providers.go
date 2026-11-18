package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProviderRepository struct{ Pool *pgxpool.Pool }

func (r ProviderRepository) List(ctx context.Context, workspaceID, tenantID string) ([]domain.Provider, error) {
	rows, err := sqlc.New(r.Pool).ListProviders(ctx, sqlc.ListProvidersParams{WorkspaceID: workspaceID, TenantID: tenantID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Provider, len(rows))
	for i, row := range rows {
		out[i] = toProvider(sqlc.GetProviderRow(row))
	}
	return out, nil
}
func (r ProviderRepository) Get(ctx context.Context, id, workspaceID, tenantID string) (domain.Provider, error) {
	row, err := sqlc.New(r.Pool).GetProvider(ctx, sqlc.GetProviderParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
	p := toProvider(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Provider{}, pgx.ErrNoRows
	}
	return p, err
}
func (r ProviderRepository) Default(ctx context.Context, workspaceID, tenantID string) (domain.Provider, error) {
	row, err := sqlc.New(r.Pool).GetDefaultProvider(ctx, sqlc.GetDefaultProviderParams{WorkspaceID: workspaceID, TenantID: tenantID})
	return toProvider(sqlc.GetProviderRow(row)), err
}
func (r ProviderRepository) ByKind(ctx context.Context, workspaceID, tenantID, kind string) (domain.Provider, error) {
	row, err := sqlc.New(r.Pool).GetProviderByKind(ctx, sqlc.GetProviderByKindParams{WorkspaceID: workspaceID, TenantID: tenantID, ProviderKind: kind})
	return toProvider(sqlc.GetProviderRow(row)), err
}
func (r ProviderRepository) Create(ctx context.Context, p domain.Provider, replaceDefault bool) (domain.Provider, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Provider{}, err
	}
	defer tx.Rollback(ctx)
	if replaceDefault {
		if err = sqlc.New(tx).LockProviderDefaults(ctx, `model-provider-default:`+p.TenantID+`:`+p.WorkspaceID); err != nil {
			return domain.Provider{}, err
		}
		if err = sqlc.New(tx).ClearDefaultProvider(ctx, sqlc.ClearDefaultProviderParams{WorkspaceID: p.WorkspaceID, TenantID: p.TenantID}); err != nil {
			return domain.Provider{}, err
		}
	}
	now := time.Now().UTC()
	p.CreatedAt = now
	p.UpdatedAt = now
	row, err := sqlc.New(tx).CreateProvider(ctx, sqlc.CreateProviderParams{
		ID:                 p.ID,
		UserID:             p.UserID,
		WorkspaceID:        p.WorkspaceID,
		TenantID:           p.TenantID,
		Name:               p.Name,
		Model:              p.Model,
		ProviderKind:       p.Kind,
		ResponsesDialect:   p.ResponsesDialect,
		BaseUrl:            p.BaseURL,
		ApiKeyEnc:          p.APIKeyEncrypted,
		ExtraBody:          p.ExtraBody,
		PricingJson:        p.PricingJSON,
		ContextWindow:      int64(p.ContextWindow),
		MaxOutputTokens:    int64(p.MaxOutputTokens),
		SupportsImageInput: p.SupportsImageInput,
		IsDefault:          p.IsDefault,
		IsEnabled:          p.IsEnabled,
		CreatedAt:          p.CreatedAt,
		UpdatedAt:          p.UpdatedAt,
	})
	p = toProvider(sqlc.GetProviderRow(row))
	if err != nil {
		return domain.Provider{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Provider{}, err
	}
	return p, nil
}
func (r ProviderRepository) Delete(ctx context.Context, id, workspaceID, tenantID string) (bool, error) {
	tag, err := sqlc.New(r.Pool).DeleteProvider(ctx, sqlc.DeleteProviderParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
	return tag > 0, err
}
func (r ProviderRepository) BulkDelete(ctx context.Context, ids []string, workspaceID, tenantID string) (int64, error) {
	tag, err := sqlc.New(r.Pool).DeleteProviders(ctx, sqlc.DeleteProvidersParams{Ids: ids, WorkspaceID: workspaceID, TenantID: tenantID})
	return tag, err
}
func (r ProviderRepository) Save(ctx context.Context, p domain.Provider) (domain.Provider, error) {
	row, err := sqlc.New(r.Pool).SaveProvider(ctx, sqlc.SaveProviderParams{
		ID:                 p.ID,
		Name:               p.Name,
		Model:              p.Model,
		ProviderKind:       p.Kind,
		ResponsesDialect:   p.ResponsesDialect,
		BaseUrl:            p.BaseURL,
		ApiKeyEnc:          p.APIKeyEncrypted,
		ExtraBody:          p.ExtraBody,
		PricingJson:        p.PricingJSON,
		ContextWindow:      int64(p.ContextWindow),
		MaxOutputTokens:    int64(p.MaxOutputTokens),
		SupportsImageInput: p.SupportsImageInput,
		IsDefault:          p.IsDefault,
		IsEnabled:          p.IsEnabled,
		WorkspaceID:        p.WorkspaceID,
		TenantID:           p.TenantID,
	})
	return toProvider(sqlc.GetProviderRow(row)), err
}
func (r ProviderRepository) SetDefault(ctx context.Context, id, workspaceID, tenantID string) (domain.Provider, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Provider{}, err
	}
	defer tx.Rollback(ctx)
	if err = sqlc.New(tx).LockProviderDefaults(ctx, `model-provider-default:`+tenantID+`:`+workspaceID); err != nil {
		return domain.Provider{}, err
	}
	_, err = sqlc.New(tx).LockProvider(ctx, sqlc.LockProviderParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
	if err != nil {
		return domain.Provider{}, err
	}
	if err = sqlc.New(tx).ClearDefaultProvider(ctx, sqlc.ClearDefaultProviderParams{WorkspaceID: workspaceID, TenantID: tenantID}); err != nil {
		return domain.Provider{}, err
	}
	row, err := sqlc.New(tx).SetDefaultProvider(ctx, id)
	p := toProvider(sqlc.GetProviderRow(row))
	if err != nil {
		return domain.Provider{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Provider{}, err
	}
	return p, nil
}

func toProvider(row sqlc.GetProviderRow) domain.Provider {
	value := domain.Provider{
		ID:                 row.ID,
		UserID:             row.UserID,
		WorkspaceID:        row.WorkspaceID,
		TenantID:           row.TenantID,
		Name:               row.Name,
		Model:              row.Model,
		Kind:               row.ProviderKind,
		ResponsesDialect:   row.ResponsesDialect,
		BaseURL:            row.BaseUrl,
		APIKeyEncrypted:    row.ApiKeyEnc,
		ExtraBody:          row.ExtraBody,
		PricingJSON:        row.PricingJson,
		ContextWindow:      int(row.ContextWindow),
		MaxOutputTokens:    int(row.MaxOutputTokens),
		SupportsImageInput: row.SupportsImageInput,
		IsDefault:          row.IsDefault,
		IsEnabled:          row.IsEnabled,
		CreatedAt:          row.CreatedAt,
		UpdatedAt:          row.UpdatedAt,
	}
	return value
}
