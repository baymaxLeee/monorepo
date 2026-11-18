-- name: ImageRunCreate :exec
INSERT INTO image_generation_runs (
    task_run_id, target_type, target_id, target_revision, tenant_id, invocation_project_id,
    workspace_id, prompt, model_id, resolution, aspect_ratio, watermark, input_snapshots,
    output_owner_type, output_owner_id, binding_outcome, stage, provider_attempt,
    provider_image_url, source_asset_id, source_revision_id, artifact_size_bytes,
    output_asset_id, error_code, error_message, created_by, created_at, updated_at,
    completed_at
) VALUES (
    @task_run_id, @target_type, @target_id, @target_revision, @tenant_id,
    @invocation_project_id, @workspace_id, @prompt, @model_id, @resolution, @aspect_ratio,
    @watermark, @input_snapshots, @output_owner_type, @output_owner_id, @binding_outcome,
    @stage, @provider_attempt, @provider_image_url, @source_asset_id, @source_revision_id,
    @artifact_size_bytes, @output_asset_id, @error_code, @error_message, @created_by,
    @created_at, @updated_at, @completed_at
);

-- name: ImageRunCreateInput :exec
INSERT INTO image_generation_run_inputs (
    task_run_id, position, source_type, asset_id
) VALUES (
    @task_run_id, @position, @source_type, @asset_id
);

-- name: ImageRunGet :one
SELECT * FROM image_generation_runs
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND task_run_id = @id;

-- name: ImageRunInputs :many
SELECT task_run_id, position, source_type, asset_id FROM image_generation_run_inputs
WHERE task_run_id = ANY(@ids::text[])
ORDER BY task_run_id, position;

-- name: ImageRunHistory :many
SELECT * FROM image_generation_runs
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND target_type = @target_type
  AND target_id = @target_id
  AND created_by = @created_by
ORDER BY created_at DESC, task_run_id DESC
LIMIT 100;

-- name: ImageRunIDs :many
SELECT task_run_id FROM image_generation_runs
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND target_type = @target_type
  AND target_id = ANY(@ids::text[])
ORDER BY task_run_id;

-- name: ImageRunLatest :many
SELECT DISTINCT ON (target_id) * FROM image_generation_runs
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND target_type = @target_type
  AND target_id = ANY(@ids::text[])
  AND created_by = @created_by
ORDER BY target_id, created_at DESC, task_run_id DESC;

-- name: ImageRunUpdate :execrows
UPDATE image_generation_runs
SET binding_outcome = @binding_outcome,
    stage = @stage,
    provider_attempt = @provider_attempt,
    provider_image_url = @provider_image_url,
    source_asset_id = @source_asset_id,
    source_revision_id = @source_revision_id,
    artifact_size_bytes = @artifact_size_bytes,
    output_asset_id = @output_asset_id,
    error_code = @error_code,
    error_message = @error_message,
    updated_at = @updated_at,
    completed_at = @completed_at
WHERE image_generation_runs.task_run_id = @task_run_id
  AND (NOT @fenced::bool OR EXISTS (SELECT 1 FROM poll_schedules p
WHERE p.task_run_id = image_generation_runs.task_run_id
  AND p.state_version = @version
  AND p.lease_until > @now::timestamptz));
