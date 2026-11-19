-- name: GetAgentPluginCatalogEntry :one
SELECT *
FROM agent_plugin_catalog
WHERE id = $1;

-- name: ListAgentPluginCatalog :many
SELECT
    catalog.id,
    catalog.display_name,
    catalog.description,
    catalog.source,
    catalog.trust,
    catalog.install_policy,
    catalog.availability,
    catalog.latest_release_digest,
    catalog.listed,
    catalog.created_at,
    catalog.updated_at,
    release.version,
    release.manifest_json,
    (installation.plugin_id IS NOT NULL)::boolean AS installed,
    COALESCE(installation.enabled, false)::boolean AS enabled,
    COALESCE(installation.revision, 0)::bigint AS state_revision
FROM agent_plugin_catalog AS catalog
JOIN agent_plugin_releases AS release
    ON release.plugin_id = catalog.id
    AND release.digest = catalog.latest_release_digest
LEFT JOIN agent_plugin_installations AS installation
    ON installation.plugin_id = catalog.id
    AND installation.tenant_id = sqlc.arg(tenant_id)
    AND installation.workspace_id = sqlc.arg(workspace_id)
WHERE catalog.listed
ORDER BY catalog.display_name, catalog.id;

-- name: ListPluginSelectionCandidates :many
SELECT
    catalog.id AS plugin_id,
    catalog.display_name,
    catalog.description,
    catalog.install_policy,
    release.manifest_json
FROM agent_plugin_installations AS installation
JOIN agent_plugin_catalog AS catalog
    ON catalog.id = installation.plugin_id
JOIN agent_plugin_releases AS release
    ON release.plugin_id = installation.plugin_id
    AND release.digest = installation.release_digest
WHERE installation.tenant_id = sqlc.arg(tenant_id)
  AND installation.workspace_id = sqlc.arg(workspace_id)
  AND installation.enabled
  AND catalog.listed
  AND catalog.availability = 'available'
  AND catalog.install_policy <> 'not-available'
ORDER BY catalog.display_name, catalog.id;

-- name: UpsertAgentPluginCatalogEntry :exec
INSERT INTO agent_plugin_catalog (
    id,
    display_name,
    description,
    source,
    trust,
    install_policy,
    availability,
    latest_release_digest,
    listed,
    created_at,
    updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    source = EXCLUDED.source,
    trust = EXCLUDED.trust,
    install_policy = EXCLUDED.install_policy,
    availability = EXCLUDED.availability,
    latest_release_digest = EXCLUDED.latest_release_digest,
    listed = EXCLUDED.listed,
    updated_at = EXCLUDED.updated_at;

-- name: GetAgentPluginRelease :one
SELECT *
FROM agent_plugin_releases
WHERE plugin_id = $1 AND digest = $2;

-- name: CreateAgentPluginRelease :exec
INSERT INTO agent_plugin_releases (plugin_id, digest, version, manifest_json, created_at)
VALUES ($1, $2, $3, $4, $5);

-- name: GetAgentPluginInstallation :one
SELECT *
FROM agent_plugin_installations
WHERE tenant_id = $1 AND workspace_id = $2 AND plugin_id = $3;

-- name: SaveAgentPluginInstallation :exec
INSERT INTO agent_plugin_installations (
    tenant_id,
    workspace_id,
    plugin_id,
    release_digest,
    enabled,
    revision,
    config_json,
    encrypted_secrets_json,
    installed_by,
    updated_by,
    created_at,
    updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (tenant_id, workspace_id, plugin_id) DO UPDATE SET
    release_digest = EXCLUDED.release_digest,
    enabled = EXCLUDED.enabled,
    revision = EXCLUDED.revision,
    config_json = EXCLUDED.config_json,
    encrypted_secrets_json = EXCLUDED.encrypted_secrets_json,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

-- name: DeleteAgentPluginInstallation :execrows
DELETE FROM agent_plugin_installations
WHERE tenant_id = $1 AND workspace_id = $2 AND plugin_id = $3;

-- name: EnsureAgentPluginWorkspaceState :exec
INSERT INTO agent_plugin_workspace_states (tenant_id, workspace_id, revision, updated_at)
VALUES ($1, $2, 1, $3)
ON CONFLICT (tenant_id, workspace_id) DO NOTHING;

-- name: GetAgentPluginWorkspaceRevision :one
SELECT revision
FROM agent_plugin_workspace_states
WHERE tenant_id = $1 AND workspace_id = $2;

-- name: LockAgentPluginWorkspaceRevision :one
SELECT revision
FROM agent_plugin_workspace_states
WHERE tenant_id = $1 AND workspace_id = $2
FOR UPDATE;

-- name: BumpAgentPluginWorkspaceRevision :one
UPDATE agent_plugin_workspace_states
SET revision = revision + 1, updated_at = $3
WHERE tenant_id = $1 AND workspace_id = $2
RETURNING revision;
