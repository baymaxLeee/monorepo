package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProviderRepository struct{ Pool *pgxpool.Pool }

const providerColumns = `id,user_id,workspace_id,tenant_id,name,model,provider_kind,responses_dialect,base_url,api_key_enc,extra_body,pricing_json,context_window,max_output_tokens,supports_image_input,is_default,is_enabled,created_at,updated_at`

type scanner interface{ Scan(...any) error }

func scanProvider(row scanner) (domain.Provider, error) {
	var p domain.Provider
	err := row.Scan(&p.ID, &p.UserID, &p.WorkspaceID, &p.TenantID, &p.Name, &p.Model, &p.Kind, &p.ResponsesDialect, &p.BaseURL, &p.APIKeyEncrypted, &p.ExtraBody, &p.PricingJSON, &p.ContextWindow, &p.MaxOutputTokens, &p.SupportsImageInput, &p.IsDefault, &p.IsEnabled, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func (r ProviderRepository) List(ctx context.Context, workspaceID, tenantID string) ([]domain.Provider, error) {
	rows, err := r.Pool.Query(ctx, `SELECT `+providerColumns+` FROM model_providers WHERE workspace_id=$1 AND tenant_id=$2 ORDER BY is_default DESC,updated_at DESC`, workspaceID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Provider{}
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
func (r ProviderRepository) Get(ctx context.Context, id, workspaceID, tenantID string) (domain.Provider, error) {
	p, err := scanProvider(r.Pool.QueryRow(ctx, `SELECT `+providerColumns+` FROM model_providers WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3`, id, workspaceID, tenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Provider{}, pgx.ErrNoRows
	}
	return p, err
}
func (r ProviderRepository) Default(ctx context.Context, workspaceID, tenantID string) (domain.Provider, error) {
	return scanProvider(r.Pool.QueryRow(ctx, `SELECT `+providerColumns+` FROM model_providers WHERE workspace_id=$1 AND tenant_id=$2 AND provider_kind='chat' AND is_default AND is_enabled ORDER BY updated_at DESC LIMIT 1`, workspaceID, tenantID))
}
func (r ProviderRepository) ByKind(ctx context.Context, workspaceID, tenantID, kind string) (domain.Provider, error) {
	return scanProvider(r.Pool.QueryRow(ctx, `SELECT `+providerColumns+` FROM model_providers WHERE workspace_id=$1 AND tenant_id=$2 AND provider_kind=$3 AND is_enabled ORDER BY updated_at DESC LIMIT 1`, workspaceID, tenantID, kind))
}
func (r ProviderRepository) Create(ctx context.Context, p domain.Provider, replaceDefault bool) (domain.Provider, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Provider{}, err
	}
	defer tx.Rollback(ctx)
	if replaceDefault {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `model-provider-default:`+p.TenantID+`:`+p.WorkspaceID); err != nil {
			return domain.Provider{}, err
		}
		if _, err = tx.Exec(ctx, `UPDATE model_providers SET is_default=false,updated_at=now() WHERE workspace_id=$1 AND tenant_id=$2 AND is_default`, p.WorkspaceID, p.TenantID); err != nil {
			return domain.Provider{}, err
		}
	}
	now := time.Now().UTC()
	p.CreatedAt = now
	p.UpdatedAt = now
	p, err = scanProvider(tx.QueryRow(ctx, `INSERT INTO model_providers (`+providerColumns+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING `+providerColumns, p.ID, p.UserID, p.WorkspaceID, p.TenantID, p.Name, p.Model, p.Kind, p.ResponsesDialect, p.BaseURL, p.APIKeyEncrypted, p.ExtraBody, p.PricingJSON, p.ContextWindow, p.MaxOutputTokens, p.SupportsImageInput, p.IsDefault, p.IsEnabled, p.CreatedAt, p.UpdatedAt))
	if err != nil {
		return domain.Provider{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Provider{}, err
	}
	return p, nil
}
func (r ProviderRepository) Delete(ctx context.Context, id, workspaceID, tenantID string) (bool, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM model_providers WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3`, id, workspaceID, tenantID)
	return tag.RowsAffected() > 0, err
}
func (r ProviderRepository) BulkDelete(ctx context.Context, ids []string, workspaceID, tenantID string) (int64, error) {
	tag, err := r.Pool.Exec(ctx, `DELETE FROM model_providers WHERE id=ANY($1) AND workspace_id=$2 AND tenant_id=$3`, ids, workspaceID, tenantID)
	return tag.RowsAffected(), err
}
func (r ProviderRepository) Save(ctx context.Context, p domain.Provider) (domain.Provider, error) {
	return scanProvider(r.Pool.QueryRow(ctx, `UPDATE model_providers SET name=$2,model=$3,provider_kind=$4,responses_dialect=$5,base_url=$6,api_key_enc=$7,extra_body=$8,pricing_json=$9,context_window=$10,max_output_tokens=$11,supports_image_input=$12,is_default=$13,is_enabled=$14,updated_at=now() WHERE id=$1 AND workspace_id=$15 AND tenant_id=$16 RETURNING `+providerColumns, p.ID, p.Name, p.Model, p.Kind, p.ResponsesDialect, p.BaseURL, p.APIKeyEncrypted, p.ExtraBody, p.PricingJSON, p.ContextWindow, p.MaxOutputTokens, p.SupportsImageInput, p.IsDefault, p.IsEnabled, p.WorkspaceID, p.TenantID))
}
func (r ProviderRepository) SetDefault(ctx context.Context, id, workspaceID, tenantID string) (domain.Provider, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return domain.Provider{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, `model-provider-default:`+tenantID+`:`+workspaceID); err != nil {
		return domain.Provider{}, err
	}
	p, err := scanProvider(tx.QueryRow(ctx, `SELECT `+providerColumns+` FROM model_providers WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3 FOR UPDATE`, id, workspaceID, tenantID))
	if err != nil {
		return domain.Provider{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE model_providers SET is_default=false,updated_at=now() WHERE workspace_id=$1 AND tenant_id=$2 AND is_default`, workspaceID, tenantID); err != nil {
		return domain.Provider{}, err
	}
	p, err = scanProvider(tx.QueryRow(ctx, `UPDATE model_providers SET is_default=true,updated_at=now() WHERE id=$1 RETURNING `+providerColumns, id))
	if err != nil {
		return domain.Provider{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Provider{}, err
	}
	return p, nil
}
