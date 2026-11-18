-- name: InsertOfficialAsset :exec
INSERT INTO official_assets (
    slug, tenant_id, workspace_id, workspace_key, source_asset_id, source_revision_id,
    internal_asset_id, resource_id, resource_asset_id, long_live_status, file_sha256, file_name,
    media_type, size_bytes, created_at, updated_at, deleted_at
) VALUES (
    sqlc.arg(slug), sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(workspace_key),
    sqlc.arg(source_asset_id), sqlc.arg(source_revision_id), sqlc.arg(internal_asset_id),
    sqlc.arg(resource_id), sqlc.arg(resource_asset_id), sqlc.arg(long_live_status),
    sqlc.arg(file_sha256), sqlc.arg(file_name), sqlc.arg(media_type), sqlc.arg(size_bytes),
    sqlc.arg(created_at), sqlc.arg(updated_at), 0
);

-- name: ReadOfficialAsset :one
SELECT *
FROM official_assets
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_key = sqlc.arg(workspace_key)
  AND deleted_at = 0
  AND slug = sqlc.arg(slug);

-- name: ReadOfficialAssetByInternalID :one
SELECT *
FROM official_assets
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_key = sqlc.arg(workspace_key)
  AND deleted_at = 0
  AND internal_asset_id = sqlc.arg(internal_id)::varchar;

-- name: ModifyOfficialAsset :execrows
UPDATE official_assets
SET internal_asset_id = sqlc.arg(internal_asset_id),
    resource_id = sqlc.arg(resource_id),
    resource_asset_id = sqlc.arg(resource_asset_id),
    long_live_status = sqlc.arg(long_live_status),
    source_asset_id = sqlc.arg(source_asset_id),
    source_revision_id = sqlc.arg(source_revision_id),
    file_sha256 = sqlc.arg(file_sha256),
    file_name = sqlc.arg(file_name),
    media_type = sqlc.arg(media_type),
    size_bytes = sqlc.arg(size_bytes),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_key = sqlc.arg(workspace_key)
  AND deleted_at = 0
  AND slug = sqlc.arg(slug);

-- name: ReadOfficialAssets :many
SELECT *
FROM official_assets
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_key = sqlc.arg(workspace_key)
  AND deleted_at = 0
ORDER BY slug;

-- name: ReadOfficialAssetsByStatus :many
SELECT *
FROM official_assets
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_key = sqlc.arg(workspace_key)
  AND deleted_at = 0
  AND long_live_status = sqlc.arg(long_live_status)
ORDER BY slug
LIMIT sqlc.arg(page_size)::int;

-- name: RetireOfficialAsset :execrows
UPDATE official_assets
SET deleted_at = sqlc.arg(retired_at)::bigint,
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_key = sqlc.arg(workspace_key)
  AND deleted_at = 0
  AND slug = sqlc.arg(slug);

-- name: ReadOfficialAssetScopes :many
SELECT DISTINCT tenant_id, workspace_id, workspace_key
FROM official_assets
ORDER BY tenant_id, workspace_key;
