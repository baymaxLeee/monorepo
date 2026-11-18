-- name: InsertProject :exec
INSERT INTO projects (
    id, tenant_id, workspace_id, name, created_by, cover_image_revision_id, cover_image_asset_id,
    cover_image_sha256, cover_image_content_type, cover_image_size_bytes,
    cover_image_claim_generation, canvas_count, selected_video_duration_millis, resource_count,
    created_at, updated_at, deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(name), sqlc.arg(created_by),
    sqlc.arg(cover_image_revision_id), sqlc.arg(cover_image_asset_id), sqlc.arg(cover_image_sha256),
    sqlc.arg(cover_image_content_type), sqlc.arg(cover_image_size_bytes),
    sqlc.arg(cover_image_claim_generation), sqlc.arg(canvas_count),
    sqlc.arg(selected_video_duration_millis), sqlc.arg(resource_count), sqlc.arg(created_at),
    sqlc.arg(updated_at), COALESCE(sqlc.narg(deleted_at)::bigint, 0)
);

-- name: InsertProjectMember :exec
INSERT INTO project_members (
    tenant_id, workspace_id, project_id, user_id, created_at, deleted_at
) VALUES (
    sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(user_id),
    sqlc.arg(created_at), 0
);

-- name: LockScopedProject :one
SELECT id
FROM projects
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
FOR UPDATE;

-- name: FindScopedProject :one
SELECT id
FROM projects
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id);

-- name: ModifyProject :exec
UPDATE projects
SET name = sqlc.arg(name),
    cover_image_revision_id = sqlc.arg(cover_image_revision_id),
    cover_image_asset_id = sqlc.arg(cover_image_asset_id),
    cover_image_sha256 = sqlc.arg(cover_image_sha256),
    cover_image_content_type = sqlc.arg(cover_image_content_type),
    cover_image_size_bytes = sqlc.arg(cover_image_size_bytes),
    cover_image_claim_generation = sqlc.arg(cover_image_claim_generation),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id);

-- name: ModifyProjectCover :execrows
UPDATE projects
SET cover_image_revision_id = sqlc.arg(cover_image_revision_id),
    cover_image_asset_id = sqlc.arg(cover_image_asset_id),
    cover_image_sha256 = sqlc.arg(cover_image_sha256),
    cover_image_content_type = sqlc.arg(cover_image_content_type),
    cover_image_size_bytes = sqlc.arg(cover_image_size_bytes),
    cover_image_claim_generation = sqlc.arg(cover_image_claim_generation),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id);

-- name: RetireProjectMembers :exec
UPDATE project_members
SET deleted_at = sqlc.arg(retired_at)::bigint
WHERE project_id = sqlc.arg(project_id)
  AND deleted_at = 0;

-- name: RetireProject :exec
UPDATE projects
SET cover_image_revision_id = NULL,
    cover_image_asset_id = NULL,
    cover_image_sha256 = NULL,
    cover_image_content_type = NULL,
    cover_image_size_bytes = 0,
    cover_image_claim_generation = 0,
    updated_at = sqlc.arg(updated_at),
    deleted_at = sqlc.arg(retired_at)::bigint
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id);

-- name: ReadProject :one
SELECT projects.*
FROM projects
WHERE projects.tenant_id = sqlc.arg(tenant_id)
  AND projects.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND projects.deleted_at = 0
  AND (
      sqlc.arg(admin)::boolean OR (
          sqlc.arg(member)::boolean AND EXISTS (
              SELECT 1
              FROM project_members m
              WHERE m.project_id = projects.id
                AND m.tenant_id = projects.tenant_id
                AND m.workspace_id IS NOT DISTINCT FROM projects.workspace_id
                AND m.deleted_at = 0
                AND m.user_id = sqlc.arg(caller_id)
          )
      )
  )
  AND projects.id = sqlc.arg(id);

-- name: ReadTenantProject :one
SELECT *
FROM projects
WHERE tenant_id = $1
  AND id = $2
  AND deleted_at = 0;

-- name: ReadProjects :many
SELECT projects.*
FROM projects
WHERE projects.tenant_id = sqlc.arg(tenant_id)
  AND projects.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND projects.deleted_at = 0
  AND (
      sqlc.arg(admin)::boolean OR (
          sqlc.arg(member)::boolean AND EXISTS (
              SELECT 1
              FROM project_members m
              WHERE m.project_id = projects.id
                AND m.tenant_id = projects.tenant_id
                AND m.workspace_id IS NOT DISTINCT FROM projects.workspace_id
                AND m.deleted_at = 0
                AND m.user_id = sqlc.arg(caller_id)
          )
      )
  )
  AND projects.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: CountProjects :one
SELECT count(*)
FROM projects
WHERE projects.tenant_id = sqlc.arg(tenant_id)
  AND projects.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND projects.deleted_at = 0
  AND (
      sqlc.arg(admin)::boolean OR (
          sqlc.arg(member)::boolean AND EXISTS (
              SELECT 1
              FROM project_members m
              WHERE m.project_id = projects.id
                AND m.tenant_id = projects.tenant_id
                AND m.workspace_id IS NOT DISTINCT FROM projects.workspace_id
                AND m.deleted_at = 0
                AND m.user_id = sqlc.arg(caller_id)
          )
      )
  )
  AND (sqlc.arg(keyword)::text = '' OR name LIKE '%' || sqlc.arg(keyword) || '%');

-- name: PageProjects :many
SELECT projects.*
FROM projects
WHERE projects.tenant_id = sqlc.arg(tenant_id)
  AND projects.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND projects.deleted_at = 0
  AND (
      sqlc.arg(admin)::boolean OR (
          sqlc.arg(member)::boolean AND EXISTS (
              SELECT 1
              FROM project_members m
              WHERE m.project_id = projects.id
                AND m.tenant_id = projects.tenant_id
                AND m.workspace_id IS NOT DISTINCT FROM projects.workspace_id
                AND m.deleted_at = 0
                AND m.user_id = sqlc.arg(caller_id)
          )
      )
  )
  AND (sqlc.arg(keyword)::text = '' OR name LIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY CASE WHEN sqlc.arg(ascending)::boolean THEN updated_at END ASC,
         CASE WHEN sqlc.arg(ascending)::boolean THEN id END ASC,
         updated_at DESC, id DESC
LIMIT sqlc.arg(page_size)::int OFFSET sqlc.arg(page_offset)::bigint;

-- name: CleanupProjects :many
SELECT *
FROM projects
WHERE tenant_id = sqlc.arg(tenant_id)
  AND deleted_at = 0
  AND (sqlc.narg(workspace_id)::varchar IS NULL OR workspace_id = sqlc.narg(workspace_id))
ORDER BY id;

-- name: ReadProjectMembers :many
SELECT m.project_id, m.user_id
FROM project_members m
JOIN projects p ON p.id = m.project_id
  AND p.tenant_id = m.tenant_id
  AND p.workspace_id IS NOT DISTINCT FROM m.workspace_id
WHERE m.project_id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
  AND m.deleted_at = 0
ORDER BY m.id;
