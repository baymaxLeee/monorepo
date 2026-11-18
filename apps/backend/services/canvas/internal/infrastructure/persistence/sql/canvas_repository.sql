-- name: InsertCanvas :exec
INSERT INTO canvases (
    id, tenant_id, workspace_id, project_id, name, cover_image_revision_id, cover_image_asset_id,
    cover_image_sha256, cover_image_content_type, cover_image_size_bytes,
    cover_image_claim_generation, canvas_node_count, selected_video_duration_millis, default_view,
    revision, created_by, created_at, updated_at, deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(name),
    sqlc.arg(cover_image_revision_id), sqlc.arg(cover_image_asset_id), sqlc.arg(cover_image_sha256),
    sqlc.arg(cover_image_content_type), sqlc.arg(cover_image_size_bytes),
    sqlc.arg(cover_image_claim_generation), sqlc.arg(canvas_node_count),
    sqlc.arg(selected_video_duration_millis), sqlc.arg(default_view), sqlc.arg(revision),
    sqlc.arg(created_by), sqlc.arg(created_at), sqlc.arg(updated_at), COALESCE(sqlc.narg(deleted_at)::bigint, 0)
);

-- name: CountActiveCanvases :one
SELECT count(*)
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id);

-- name: ReadCanvas :one
SELECT *
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND id = sqlc.arg(id);

-- name: ReadCanvases :many
SELECT *
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: CountFilteredCanvases :one
SELECT count(*)
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND (sqlc.arg(author)::text = '' OR created_by = sqlc.arg(author))
  AND (sqlc.arg(keyword)::text = '' OR name LIKE '%' || sqlc.arg(keyword) || '%');

-- name: PageCanvases :many
SELECT *
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND (sqlc.arg(author)::text = '' OR created_by = sqlc.arg(author))
  AND (sqlc.arg(keyword)::text = '' OR name LIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY CASE WHEN sqlc.arg(ascending)::boolean THEN updated_at END ASC,
         CASE WHEN sqlc.arg(ascending)::boolean THEN id END ASC,
         updated_at DESC, id DESC
LIMIT sqlc.arg(page_size)::int OFFSET sqlc.arg(page_offset)::bigint;

-- name: ModifyCanvas :execrows
UPDATE canvases
SET name = sqlc.arg(name),
    cover_image_revision_id = sqlc.arg(cover_image_revision_id),
    cover_image_asset_id = sqlc.arg(cover_image_asset_id),
    cover_image_sha256 = sqlc.arg(cover_image_sha256),
    cover_image_content_type = sqlc.arg(cover_image_content_type),
    cover_image_size_bytes = sqlc.arg(cover_image_size_bytes),
    cover_image_claim_generation = sqlc.arg(cover_image_claim_generation),
    revision = sqlc.arg(revision),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND id = sqlc.arg(id);

-- name: ModifyCanvasView :execrows
UPDATE canvases
SET default_view = sqlc.arg(default_view)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND id = sqlc.arg(id);

-- name: RetireCanvas :execrows
UPDATE canvases
SET cover_image_revision_id = NULL,
    cover_image_asset_id = NULL,
    cover_image_sha256 = NULL,
    cover_image_content_type = NULL,
    cover_image_size_bytes = 0,
    cover_image_claim_generation = 0,
    revision = sqlc.arg(revision),
    updated_at = sqlc.arg(updated_at),
    deleted_at = sqlc.arg(retired_at)::bigint
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
  AND id = sqlc.arg(id);

-- name: LockProjectCanvases :many
SELECT *
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND project_id = sqlc.arg(project_id)
ORDER BY id
FOR UPDATE;

-- name: RetireProjectCanvases :exec
UPDATE canvases
SET cover_image_revision_id = NULL,
    cover_image_asset_id = NULL,
    cover_image_sha256 = NULL,
    cover_image_content_type = NULL,
    cover_image_size_bytes = 0,
    cover_image_claim_generation = 0,
    updated_at = sqlc.arg(updated_at),
    deleted_at = sqlc.arg(retired_at)::bigint
WHERE id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
  AND deleted_at = 0;

-- name: MatchDeletedCanvas :one
SELECT EXISTS(SELECT 1
FROM canvases
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND id = sqlc.arg(id)
  AND project_id = sqlc.arg(project_id)
  AND revision = sqlc.arg(revision)
  AND deleted_at = sqlc.arg(retired_at)::bigint);
