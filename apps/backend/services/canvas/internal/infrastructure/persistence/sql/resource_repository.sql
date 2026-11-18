-- name: CountAssetsForReview :one
SELECT count(*)
FROM resources r
JOIN project_resource_rel rel ON rel.resource_id = r.id
  AND rel.deleted_at = 0
JOIN resource_assets s ON s.resource_id = r.id
  AND s.deleted_at = 0
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND r.id = sqlc.arg(id)
  AND rel.project_id = sqlc.arg(project_id)
  AND s.current_asset_id = sqlc.arg(asset_id)::varchar;

-- name: InsertResource :exec
INSERT INTO resources (
    id, tenant_id, workspace_id, owner_type, owner_id, type, name, description,
    primary_resource_asset_id, revision, resource_asset_count, created_by, created_at, updated_at,
    deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(owner_type),
    sqlc.arg(owner_id), sqlc.arg(type), sqlc.arg(name), sqlc.arg(description),
    sqlc.arg(primary_resource_asset_id), sqlc.arg(revision), sqlc.arg(resource_asset_count),
    sqlc.arg(created_by), sqlc.arg(created_at), sqlc.arg(updated_at), COALESCE(sqlc.narg(deleted_at)::bigint, 0)
);

-- name: InsertResourceRelation :exec
INSERT INTO project_resource_rel (
    project_id, resource_id, created_at, deleted_at
) VALUES (
    sqlc.arg(project_id), sqlc.arg(resource_id), sqlc.arg(created_at), 0
);

-- name: CountOwnedResourceType :one
SELECT count(*)
FROM resources
WHERE owner_type = $1
  AND owner_id = $2
  AND type = $3
  AND deleted_at = 0;

-- name: OwnedResourceNameExists :one
SELECT EXISTS(SELECT 1
FROM resources
WHERE owner_type = $1
  AND owner_id = $2
  AND name = $3
  AND deleted_at = 0);

-- name: ReadVisibleResource :one
SELECT r.*
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
  AND r.id = sqlc.arg(id);

-- name: ReadVisibleResources :many
SELECT r.*
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
  AND r.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: CountVisibleResources :one
SELECT count(*)
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
  AND (sqlc.narg(resource_type)::smallint IS NULL OR r.type = sqlc.narg(resource_type))
  AND (sqlc.arg(keyword)::text = '' OR r.name LIKE '%' || sqlc.arg(keyword) || '%');

-- name: PageVisibleResources :many
SELECT r.*
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
  AND (sqlc.narg(resource_type)::smallint IS NULL OR r.type = sqlc.narg(resource_type))
  AND (sqlc.arg(keyword)::text = '' OR r.name LIKE '%' || sqlc.arg(keyword) || '%')
ORDER BY (r.owner_type = 2),
    CASE WHEN sqlc.arg(ascending)::boolean THEN CASE WHEN sqlc.arg(by_created)::boolean THEN r.created_at ELSE r.updated_at END END ASC,
    CASE WHEN sqlc.arg(ascending)::boolean THEN r.id END ASC,
    CASE WHEN sqlc.arg(by_created)::boolean THEN r.created_at ELSE r.updated_at END DESC, r.id DESC
LIMIT sqlc.arg(page_size)::int OFFSET sqlc.arg(page_offset)::bigint;

-- name: VisibleResourceStats :many
SELECT r.type, count(*)::integer AS count
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
GROUP BY r.type;

-- name: ResourceApprovalCounts :many
SELECT s.resource_id, count(DISTINCT s.id)::integer AS approved_count
FROM resource_assets s
JOIN resources r ON r.id = s.resource_id
JOIN asset_reviews v ON v.asset_id = s.current_asset_id
  AND v.tenant_id = r.tenant_id
  AND v.workspace_id IS NOT DISTINCT FROM r.workspace_id
  AND v.deleted_at = 0
  AND v.status = 'APPROVED'
WHERE s.deleted_at = 0
  AND s.resource_id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
GROUP BY s.resource_id;

-- name: ModifyResource :execrows
UPDATE resources
SET name = sqlc.arg(name),
    description = sqlc.arg(description),
    primary_resource_asset_id = sqlc.arg(primary_resource_asset_id),
    revision = sqlc.arg(revision),
    resource_asset_count = sqlc.arg(resource_asset_count),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
  AND owner_type = sqlc.arg(owner_type)
  AND owner_id = sqlc.arg(owner_id)
  AND revision = sqlc.arg(expected_revision)::bigint;

-- name: LockProjectResource :one
SELECT r.*
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND r.owner_type = 1
  AND r.owner_id = sqlc.arg(project_id)
  AND EXISTS (SELECT 1
FROM project_resource_rel rel
JOIN projects p ON p.id = rel.project_id
  AND p.tenant_id = r.tenant_id
  AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
  AND p.deleted_at = 0
WHERE rel.deleted_at = 0
  AND rel.resource_id = r.id
  AND rel.project_id = sqlc.arg(project_id))
  AND r.id = sqlc.arg(id)
FOR UPDATE;

-- name: LockOwnedResources :many
SELECT r.*
FROM resources r
WHERE r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND r.owner_type = 1
  AND r.owner_id = sqlc.arg(project_id)
ORDER BY r.id
FOR UPDATE;

-- name: NextAssetSlotSequence :one
SELECT (coalesce(max(sequence_no), 0)+1)::bigint
FROM resource_assets
WHERE resource_id = $1;

-- name: AssetSlotNameExists :one
SELECT EXISTS(SELECT 1
FROM resource_assets
WHERE resource_id = $1
  AND name = $2
  AND deleted_at = 0);

-- name: InsertAssetSlot :exec
INSERT INTO resource_assets (
    id, resource_id, name, sequence_no, source_type, current_asset_id, image_generation_draft_id,
    media_type, revision, created_at, updated_at, deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(resource_id), sqlc.arg(name), sqlc.arg(sequence_no),
    sqlc.arg(source_type), sqlc.arg(current_asset_id), sqlc.arg(image_generation_draft_id),
    sqlc.arg(media_type), sqlc.arg(revision), sqlc.arg(created_at), sqlc.arg(updated_at), 0
);

-- name: InsertSlotRevision :exec
INSERT INTO resource_asset_revisions (
    resource_asset_id, asset_id, media_type, revision_no, created_at
) VALUES (
    sqlc.arg(resource_asset_id), sqlc.arg(asset_id), sqlc.arg(media_type), sqlc.arg(revision_no),
    sqlc.arg(created_at)
);

-- name: LockSlotBySequence :one
SELECT *
FROM resource_assets
WHERE resource_id = $1
  AND sequence_no = $2
  AND deleted_at = 0
FOR UPDATE;

-- name: ReadVisibleSlots :many
SELECT s.*
FROM resource_assets s
JOIN resources r ON r.id = s.resource_id
WHERE s.deleted_at = 0
  AND r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
  AND s.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[]);

-- name: ReadVisibleResourceSlots :many
SELECT s.*
FROM resource_assets s
JOIN resources r ON r.id = s.resource_id
WHERE s.deleted_at = 0
  AND r.tenant_id = sqlc.arg(tenant_id)
  AND r.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND r.deleted_at = 0
  AND (
      r.owner_type = 2 OR (
          r.owner_type = 1 AND r.owner_id = sqlc.arg(project_id)
          AND EXISTS (
              SELECT 1
              FROM project_resource_rel rel
              JOIN projects p ON p.id = rel.project_id
                AND p.tenant_id = r.tenant_id
                AND p.workspace_id IS NOT DISTINCT FROM r.workspace_id
                AND p.deleted_at = 0
              WHERE rel.deleted_at = 0
                AND rel.resource_id = r.id
                AND rel.project_id = sqlc.arg(project_id)
          )
      )
  )
  AND r.id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
ORDER BY s.sequence_no, s.id;

-- name: ReadResourceSlot :one
SELECT *
FROM resource_assets
WHERE resource_id = sqlc.arg(resource_id)
  AND id = sqlc.arg(id)
  AND deleted_at = 0;

-- name: LockResourceSlot :one
SELECT *
FROM resource_assets
WHERE resource_id = sqlc.arg(resource_id)
  AND id = sqlc.arg(id)
  AND deleted_at = 0
FOR UPDATE;

-- name: SlotRevisionExists :one
SELECT EXISTS(SELECT 1
FROM resource_asset_revisions
WHERE resource_asset_id = $1
  AND asset_id = $2);

-- name: CountResourceSlots :one
SELECT count(*)
FROM resource_assets
WHERE resource_id = $1
  AND deleted_at = 0;

-- name: PageResourceSlots :many
SELECT *
FROM resource_assets
WHERE resource_id = sqlc.arg(resource_id)
  AND deleted_at = 0
ORDER BY CASE WHEN id = sqlc.narg(primary_id)::varchar THEN 0 ELSE 1 END, sequence_no, id
LIMIT sqlc.arg(page_size)::int OFFSET sqlc.arg(page_offset)::bigint;

-- name: ModifyAssetSlot :execrows
UPDATE resource_assets
SET name = sqlc.arg(name),
    current_asset_id = sqlc.arg(current_asset_id),
    media_type = sqlc.arg(media_type),
    revision = sqlc.arg(revision),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND resource_id = sqlc.arg(resource_id)
  AND revision = sqlc.arg(expected_revision)::bigint
  AND deleted_at = 0;

-- name: NextSlotRevision :one
SELECT (coalesce(max(revision_no), 0)+1)::bigint
FROM resource_asset_revisions
WHERE resource_asset_id = $1;

-- name: RetireAssetSlot :execrows
UPDATE resource_assets
SET revision = revision+1,
    updated_at = sqlc.arg(updated_at),
    deleted_at = sqlc.arg(retired_at)::bigint
WHERE id = sqlc.arg(id)
  AND resource_id = sqlc.arg(resource_id)
  AND revision = sqlc.arg(expected_revision)::bigint
  AND deleted_at = 0;

-- name: SlotRevisionAssetIDs :many
SELECT DISTINCT asset_id
FROM resource_asset_revisions
WHERE resource_asset_id = $1
ORDER BY asset_id;

-- name: ResourceRevisionAssetIDs :many
SELECT DISTINCT v.asset_id
FROM resource_asset_revisions v
JOIN resource_assets s ON s.id = v.resource_asset_id
  AND s.deleted_at = 0
WHERE s.resource_id = $1
ORDER BY v.asset_id;

-- name: RetireResourceSlots :exec
UPDATE resource_assets
SET deleted_at = sqlc.arg(retired_at)::bigint,
    updated_at = sqlc.arg(updated_at)
WHERE resource_id = sqlc.arg(resource_id)
  AND deleted_at = 0;

-- name: RetireResourceRelations :exec
UPDATE project_resource_rel
SET deleted_at = sqlc.arg(retired_at)::bigint
WHERE resource_id = sqlc.arg(resource_id)
  AND deleted_at = 0;

-- name: RetireResource :execrows
UPDATE resources
SET revision = sqlc.arg(revision),
    updated_at = sqlc.arg(updated_at),
    deleted_at = sqlc.arg(retired_at)::bigint
WHERE id = sqlc.arg(id)
  AND tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND owner_type = sqlc.arg(owner_type)
  AND owner_id = sqlc.arg(owner_id)
  AND revision = sqlc.arg(expected_revision)::bigint
  AND deleted_at = 0;

-- name: ReadOfficialResource :one
SELECT *
FROM resources
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
  AND owner_type = 2;

-- name: ModifyOfficialResource :execrows
UPDATE resources
SET name = sqlc.arg(name),
    description = sqlc.arg(description),
    revision = sqlc.arg(revision),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
  AND owner_type = 2
  AND revision = sqlc.arg(expected_revision)::bigint;
