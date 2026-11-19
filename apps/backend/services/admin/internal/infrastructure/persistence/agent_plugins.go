package persistence

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AgentPluginRepository struct {
	Pool *pgxpool.Pool
	DB   sqlc.DBTX
}

func (r AgentPluginRepository) db() sqlc.DBTX {
	if r.DB != nil {
		return r.DB
	}
	return r.Pool
}

func (r AgentPluginRepository) Transaction(ctx context.Context, fn func(application.AgentPluginRepository) error) error {
	if tx, ok := r.DB.(pgx.Tx); ok {
		return fn(AgentPluginRepository{Pool: r.Pool, DB: tx})
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = fn(AgentPluginRepository{Pool: r.Pool, DB: tx}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r AgentPluginRepository) GetCatalogEntry(ctx context.Context, id string) (domain.AgentPluginCatalogEntry, error) {
	row, err := sqlc.New(r.db()).GetAgentPluginCatalogEntry(ctx, id)
	return agentPluginCatalogEntry(row), err
}

func (r AgentPluginRepository) ListCatalog(ctx context.Context, tenantID, workspaceID string) ([]domain.AgentPluginListItem, error) {
	rows, err := sqlc.New(r.db()).ListAgentPluginCatalog(ctx, sqlc.ListAgentPluginCatalogParams{TenantID: tenantID, WorkspaceID: workspaceID})
	if err != nil {
		return nil, err
	}
	result := make([]domain.AgentPluginListItem, 0, len(rows))
	for _, row := range rows {
		var manifest domain.AgentPluginManifest
		if err = json.Unmarshal(row.ManifestJson, &manifest); err != nil {
			return nil, fmt.Errorf("decode agent plugin release %s/%s: %w", row.ID, row.LatestReleaseDigest, err)
		}
		result = append(result, domain.AgentPluginListItem{
			Catalog: domain.AgentPluginCatalogEntry{
				ID: row.ID, DisplayName: row.DisplayName, Description: row.Description,
				Source: domain.AgentPluginSourceKind(row.Source), Trust: domain.AgentPluginTrustLevel(row.Trust),
				InstallPolicy: domain.AgentPluginInstallPolicy(row.InstallPolicy), Availability: row.Availability,
				LatestReleaseDigest: row.LatestReleaseDigest, Listed: row.Listed, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			},
			Manifest: manifest, Installed: row.Installed, Enabled: row.Enabled, StateRevision: row.StateRevision,
		})
	}
	return result, nil
}

func (r AgentPluginRepository) ListPluginSelectionCandidates(ctx context.Context, tenantID, workspaceID string) ([]domain.AgentPluginSelectionCandidate, error) {
	rows, err := sqlc.New(r.db()).ListPluginSelectionCandidates(ctx, sqlc.ListPluginSelectionCandidatesParams{
		TenantID: tenantID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return nil, err
	}
	result := make([]domain.AgentPluginSelectionCandidate, 0, len(rows))
	for _, row := range rows {
		var manifest domain.AgentPluginManifest
		if err = json.Unmarshal(row.ManifestJson, &manifest); err != nil {
			return nil, fmt.Errorf("decode installed agent plugin release %s: %w", row.PluginID, err)
		}
		result = append(result, domain.AgentPluginSelectionCandidate{
			PluginID: row.PluginID, DisplayName: row.DisplayName, Description: row.Description,
			InstallPolicy: domain.AgentPluginInstallPolicy(row.InstallPolicy), Manifest: manifest,
		})
	}
	return result, nil
}

func (r AgentPluginRepository) UpsertCatalogEntry(ctx context.Context, value domain.AgentPluginCatalogEntry) error {
	now := time.Now().UTC()
	if value.CreatedAt.IsZero() {
		value.CreatedAt = now
	}
	if value.UpdatedAt.IsZero() {
		value.UpdatedAt = now
	}
	return sqlc.New(r.db()).UpsertAgentPluginCatalogEntry(ctx, sqlc.UpsertAgentPluginCatalogEntryParams{
		ID: value.ID, DisplayName: value.DisplayName, Description: value.Description,
		Source: string(value.Source), Trust: string(value.Trust), InstallPolicy: string(value.InstallPolicy),
		Availability: value.Availability, LatestReleaseDigest: value.LatestReleaseDigest, Listed: value.Listed,
		CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	})
}

func (r AgentPluginRepository) GetRelease(ctx context.Context, pluginID, digest string) (domain.AgentPluginManifest, error) {
	row, err := sqlc.New(r.db()).GetAgentPluginRelease(ctx, sqlc.GetAgentPluginReleaseParams{PluginID: pluginID, Digest: digest})
	if err != nil {
		return domain.AgentPluginManifest{}, err
	}
	var manifest domain.AgentPluginManifest
	if err = json.Unmarshal(row.ManifestJson, &manifest); err != nil {
		return domain.AgentPluginManifest{}, fmt.Errorf("decode agent plugin release %s/%s: %w", pluginID, digest, err)
	}
	return manifest, nil
}

func (r AgentPluginRepository) CreateRelease(ctx context.Context, value domain.AgentPluginManifest) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode agent plugin release %s/%s: %w", value.ID, value.Digest, err)
	}
	return sqlc.New(r.db()).CreateAgentPluginRelease(ctx, sqlc.CreateAgentPluginReleaseParams{
		PluginID: value.ID, Digest: value.Digest, Version: value.Version, ManifestJson: raw, CreatedAt: time.Now().UTC(),
	})
}

func (r AgentPluginRepository) GetInstallation(ctx context.Context, tenantID, workspaceID, pluginID string) (domain.AgentPluginInstallation, error) {
	row, err := sqlc.New(r.db()).GetAgentPluginInstallation(ctx, sqlc.GetAgentPluginInstallationParams{
		TenantID: tenantID, WorkspaceID: workspaceID, PluginID: pluginID,
	})
	if err != nil {
		return domain.AgentPluginInstallation{}, err
	}
	return agentPluginInstallation(row)
}

func (r AgentPluginRepository) SaveInstallation(ctx context.Context, value domain.AgentPluginInstallation) error {
	config, err := json.Marshal(value.Config)
	if err != nil {
		return fmt.Errorf("encode agent plugin installation config: %w", err)
	}
	secrets, err := json.Marshal(value.EncryptedSecrets)
	if err != nil {
		return fmt.Errorf("encode agent plugin installation secrets: %w", err)
	}
	return sqlc.New(r.db()).SaveAgentPluginInstallation(ctx, sqlc.SaveAgentPluginInstallationParams{
		TenantID: value.TenantID, WorkspaceID: value.WorkspaceID, PluginID: value.PluginID,
		ReleaseDigest: value.ReleaseDigest, Enabled: value.Enabled, Revision: value.Revision,
		ConfigJson: config, EncryptedSecretsJson: secrets, InstalledBy: value.InstalledBy,
		UpdatedBy: value.UpdatedBy, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	})
}

func (r AgentPluginRepository) DeleteInstallation(ctx context.Context, tenantID, workspaceID, pluginID string) (bool, error) {
	count, err := sqlc.New(r.db()).DeleteAgentPluginInstallation(ctx, sqlc.DeleteAgentPluginInstallationParams{
		TenantID: tenantID, WorkspaceID: workspaceID, PluginID: pluginID,
	})
	return count > 0, err
}

func (r AgentPluginRepository) WorkspaceRevision(ctx context.Context, tenantID, workspaceID string, lock bool) (int64, error) {
	queries := sqlc.New(r.db())
	params := sqlc.EnsureAgentPluginWorkspaceStateParams{TenantID: tenantID, WorkspaceID: workspaceID, UpdatedAt: time.Now().UTC()}
	if err := queries.EnsureAgentPluginWorkspaceState(ctx, params); err != nil {
		return 0, err
	}
	if lock {
		return queries.LockAgentPluginWorkspaceRevision(ctx, sqlc.LockAgentPluginWorkspaceRevisionParams{TenantID: tenantID, WorkspaceID: workspaceID})
	}
	return queries.GetAgentPluginWorkspaceRevision(ctx, sqlc.GetAgentPluginWorkspaceRevisionParams{TenantID: tenantID, WorkspaceID: workspaceID})
}

func (r AgentPluginRepository) BumpWorkspaceRevision(ctx context.Context, tenantID, workspaceID string, now time.Time) (int64, error) {
	return sqlc.New(r.db()).BumpAgentPluginWorkspaceRevision(ctx, sqlc.BumpAgentPluginWorkspaceRevisionParams{
		TenantID: tenantID, WorkspaceID: workspaceID, UpdatedAt: now,
	})
}

func agentPluginCatalogEntry(row sqlc.AgentPluginCatalog) domain.AgentPluginCatalogEntry {
	return domain.AgentPluginCatalogEntry{
		ID: row.ID, DisplayName: row.DisplayName, Description: row.Description,
		Source: domain.AgentPluginSourceKind(row.Source), Trust: domain.AgentPluginTrustLevel(row.Trust),
		InstallPolicy: domain.AgentPluginInstallPolicy(row.InstallPolicy), Availability: row.Availability,
		LatestReleaseDigest: row.LatestReleaseDigest, Listed: row.Listed, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func agentPluginInstallation(row sqlc.AgentPluginInstallation) (domain.AgentPluginInstallation, error) {
	value := domain.AgentPluginInstallation{
		TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, PluginID: row.PluginID,
		ReleaseDigest: row.ReleaseDigest, Enabled: row.Enabled, Revision: row.Revision,
		InstalledBy: row.InstalledBy, UpdatedBy: row.UpdatedBy, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	if err := json.Unmarshal(row.ConfigJson, &value.Config); err != nil {
		return domain.AgentPluginInstallation{}, fmt.Errorf("decode agent plugin installation config: %w", err)
	}
	if err := json.Unmarshal(row.EncryptedSecretsJson, &value.EncryptedSecrets); err != nil {
		return domain.AgentPluginInstallation{}, fmt.Errorf("decode agent plugin installation secrets: %w", err)
	}
	return value, nil
}
