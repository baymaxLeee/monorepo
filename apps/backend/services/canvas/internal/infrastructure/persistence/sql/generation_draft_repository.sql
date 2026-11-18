-- name: InsertGenerationDraft :exec
INSERT INTO resource_asset_image_generation_drafts (
    id, tenant_id, workspace_id, resource_id, resource_asset_id, prompt, model_id, resolution,
    aspect_ratio, watermark, revision, active_task_run_id, created_by, created_at, updated_at,
    deleted_at
) VALUES (
    sqlc.arg(id), sqlc.arg(tenant_id), sqlc.arg(workspace_id), sqlc.arg(resource_id),
    sqlc.arg(resource_asset_id), sqlc.arg(prompt), sqlc.arg(model_id), sqlc.arg(resolution),
    sqlc.arg(aspect_ratio), sqlc.arg(watermark), sqlc.arg(revision), sqlc.arg(active_task_run_id),
    sqlc.arg(created_by), sqlc.arg(created_at), sqlc.arg(updated_at), 0
);

-- name: ReadGenerationDraft :one
SELECT *
FROM resource_asset_image_generation_drafts
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id);

-- name: LockGenerationDraft :one
SELECT *
FROM resource_asset_image_generation_drafts
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
FOR UPDATE;

-- name: InsertUploadedDraftRef :exec
INSERT INTO resource_asset_image_generation_uploaded_references (
    draft_id, "position", asset_id
) VALUES (
    sqlc.arg(draft_id), sqlc.arg(position_index), sqlc.arg(asset_id)
);

-- name: InsertResourceDraftRef :exec
INSERT INTO resource_asset_image_generation_resource_references (
    draft_id, "position", resource_id, sequence_no
) VALUES (
    sqlc.arg(draft_id), sqlc.arg(position_index), sqlc.arg(resource_id), sqlc.arg(sequence_no)
);

-- name: ReadUploadedDraftRefs :many
SELECT *
FROM resource_asset_image_generation_uploaded_references
WHERE draft_id = $1
ORDER BY position;

-- name: ReadResourceDraftRefs :many
SELECT *
FROM resource_asset_image_generation_resource_references
WHERE draft_id = $1
ORDER BY position;

-- name: ClearUploadedDraftRefs :exec
DELETE FROM resource_asset_image_generation_uploaded_references
WHERE draft_id = $1;

-- name: ClearResourceDraftRefs :exec
DELETE FROM resource_asset_image_generation_resource_references
WHERE draft_id = $1;

-- name: ModifyGenerationDraft :execrows
UPDATE resource_asset_image_generation_drafts
SET prompt = sqlc.arg(prompt),
    model_id = sqlc.arg(model_id),
    resolution = sqlc.arg(resolution),
    aspect_ratio = sqlc.arg(aspect_ratio),
    watermark = sqlc.arg(watermark),
    revision = sqlc.arg(revision),
    updated_at = sqlc.arg(updated_at)
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
  AND revision = sqlc.arg(expected_revision)::bigint;

-- name: LockResourceDrafts :many
SELECT id
FROM resource_asset_image_generation_drafts
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND resource_id = sqlc.arg(resource_id)
ORDER BY id
FOR UPDATE;

-- name: RetireGenerationDrafts :exec
UPDATE resource_asset_image_generation_drafts
SET active_task_run_id = NULL,
    deleted_at = sqlc.arg(retired_at)::bigint
WHERE id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
  AND deleted_at = 0;

-- name: ListUploadedDraftAssetIDs :many
SELECT asset_id
FROM resource_asset_image_generation_uploaded_references
WHERE draft_id = ANY(sqlc.arg(ids)::varchar[]::bpchar[])
ORDER BY draft_id, position;

-- name: SetDraftActiveRun :execrows
UPDATE resource_asset_image_generation_drafts
SET active_task_run_id = sqlc.arg(task_id)::varchar,
    updated_at = now()
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
  AND active_task_run_id IS NULL;

-- name: ClearDraftActiveRun :execrows
UPDATE resource_asset_image_generation_drafts
SET active_task_run_id = NULL,
    updated_at = now()
WHERE tenant_id = sqlc.arg(tenant_id)
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND deleted_at = 0
  AND id = sqlc.arg(id)
  AND active_task_run_id = sqlc.arg(task_id)::varchar;
