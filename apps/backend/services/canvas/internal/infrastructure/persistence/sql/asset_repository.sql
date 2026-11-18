-- name: InsertOwnedAsset :exec
INSERT INTO assets (
    id, tenant_id, workspace_id, owner_type, owner_id, creation_key, source_asset_id,
    source_revision_id, file_name, media_type, content_type, size_bytes, billing_class, created_by,
    created_at, deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(owner_type),
    sqlc.arg(owner_id), sqlc.arg(creation_key), sqlc.arg(source_asset_id),
    sqlc.arg(source_revision_id), sqlc.arg(file_name), sqlc.arg(media_type), sqlc.arg(content_type),
    sqlc.arg(size_bytes), sqlc.arg(billing_class), sqlc.arg(created_by), sqlc.arg(created_at), 0
);

-- name: FindAssetResourceOwner :one
SELECT r.id
FROM resources r
JOIN projects p ON p.id = r.owner_id
  AND p.tenant_id = r.tenant_id
  AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
  AND p.deleted_at = 0
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND r.id = sqlc.arg(id)
  AND r.owner_type = 1;

-- name: LockAssetResourceOwner :one
SELECT r.id
FROM resources r
JOIN projects p ON p.id = r.owner_id
  AND p.tenant_id = r.tenant_id
  AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
  AND p.deleted_at = 0
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND r.id = sqlc.arg(id)
  AND r.owner_type = 1
FOR UPDATE;

-- name: ReadOwnedAsset :one
SELECT a.*
FROM assets a
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND a.id = sqlc.arg(id);

-- name: LockOwnedAsset :one
SELECT a.*
FROM assets a
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND a.id = sqlc.arg(id)
FOR UPDATE;

-- name: ReadOwnedAssetUnscoped :one
SELECT *
FROM assets
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND id = sqlc.arg(id);

-- name: ReadAssetForCreation :one
SELECT a.*
FROM assets a
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND a.owner_type = sqlc.arg(owner_type)
  AND a.owner_id = sqlc.arg(owner_id)
  AND a.creation_key = sqlc.arg(creation_key)::varchar;

-- name: ReadReferencedAsset :one
SELECT a.*
FROM assets a
JOIN asset_references r ON r.asset_id = a.id
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND r.owner_type = sqlc.arg(owner_type)
  AND r.owner_key = sqlc.arg(owner_key)
  AND r.deleted_at = 0
  AND a.id = sqlc.arg(id);

-- name: LockReferencedAsset :one
SELECT a.*
FROM assets a
JOIN asset_references r ON r.asset_id = a.id
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND r.owner_type = sqlc.arg(owner_type)
  AND r.owner_key = sqlc.arg(owner_key)
  AND r.deleted_at = 0
  AND a.id = sqlc.arg(id)
FOR UPDATE OF a;

-- name: ReadOwnedAssets :many
SELECT a.*
FROM assets a
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND a.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: ReadReferencedAssets :many
SELECT a.*
FROM assets a
JOIN asset_references r ON r.asset_id = a.id
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND r.owner_type = sqlc.arg(owner_type)
  AND r.owner_key = sqlc.arg(owner_key)
  AND r.deleted_at = 0
  AND a.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: MatchAssetReferences :many
SELECT sqlc.embed(a), r.owner_type, r.owner_key
FROM assets a
JOIN asset_references r ON r.asset_id = a.id
JOIN (SELECT DISTINCT unnest(sqlc.arg(ids)::varchar[]::bpchar[]) AS asset_id,
             unnest(sqlc.arg(types)::varchar[]) AS owner_type,
             unnest(sqlc.arg(keys)::varchar[]) AS owner_key) requested
  ON requested.asset_id = r.asset_id
  AND requested.owner_type = r.owner_type
  AND requested.owner_key = r.owner_key
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND r.deleted_at = 0;

-- name: ListOwnedAssets :many
SELECT a.*
FROM assets a
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND a.owner_type = sqlc.arg(owner_type)
  AND a.owner_id = sqlc.arg(owner_id)
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg(page_size)::int;

-- name: LockAssetsForRetirement :many
SELECT *
FROM assets
WHERE deleted_at = 0
  AND tenant_id = sqlc.arg(tenant_id)
  AND (sqlc.arg(all_workspaces)::boolean OR workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar)
  AND (sqlc.narg(owner_id)::varchar IS NULL OR (owner_id = sqlc.narg(owner_id)
  AND owner_type = sqlc.arg(owner_type)))
ORDER BY id
FOR UPDATE;

-- name: RetireOwnedAsset :execrows
UPDATE assets
SET deleted_at = sqlc.arg(retired_at)::bigint
WHERE id = sqlc.arg(id)
  AND deleted_at = 0;

-- name: RetireAssetReferences :exec
UPDATE asset_references
SET deleted_at = sqlc.arg(retired_at)::bigint,
    updated_at = sqlc.arg(updated_at)
WHERE asset_id = sqlc.arg(asset_id)
  AND deleted_at = 0;

-- name: LockAssetsForReferences :many
SELECT a.id
FROM assets a
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND a.deleted_at = 0
  AND a.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
ORDER BY a.id
FOR UPDATE;

-- name: AcquireAssetReference :exec
INSERT INTO asset_references(asset_id, owner_type, owner_key, created_at, updated_at, deleted_at)
VALUES(sqlc.arg(asset_id), sqlc.arg(owner_type), sqlc.arg(owner_key), sqlc.arg(created_at), sqlc.arg(created_at), 0)
ON CONFLICT(asset_id, owner_type, owner_key) DO UPDATE SET deleted_at = 0,
    updated_at = EXCLUDED.updated_at
WHERE asset_references.deleted_at <> 0;

-- name: ReleaseScopedAssetReferences :exec
UPDATE asset_references r
SET deleted_at = sqlc.arg(retired_at)::bigint,
    updated_at = sqlc.arg(updated_at)
FROM assets a
WHERE a.id = r.asset_id
  AND a.tenant_id = sqlc.arg(tenant_id)
  AND a.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND r.owner_type = sqlc.arg(owner_type)
  AND r.owner_key = sqlc.arg(owner_key)
AND (sqlc.arg(all_assets)::boolean OR (a.deleted_at = 0
  AND a.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])));
