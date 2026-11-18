-- name: VideoGenCreate :exec
INSERT INTO canvas_node_generations (
    task_run_id, tenant_id, workspace_id, project_id, canvas_id, node_id, hidden_at, status,
    provider_status, model_service_id, resolution, aspect_ratio, duration_seconds,
    output_duration_seconds, generate_audio, watermark, prompt, provider_workspace_id,
    provider_task_id, provider_video_url, provider_error_code, provider_error_message,
    asset_id, first_last_frame_task_run_id, first_frame_checkpoint_asset_id,
    first_frame_checkpoint_revision_id, last_frame_checkpoint_asset_id,
    last_frame_checkpoint_revision_id, first_frame_checkpoint_size_bytes,
    last_frame_checkpoint_size_bytes, first_frame_asset_id, last_frame_asset_id, inputs,
    error_message, created_by, completed_at, created_at, updated_at, real_task_id
) VALUES (
    @task_run_id, @tenant_id, @workspace_id, @project_id, @canvas_id, @node_id, @hidden_at,
    @status, @provider_status, @model_service_id, @resolution, @aspect_ratio,
    @duration_seconds, @output_duration_seconds, @generate_audio, @watermark, @prompt,
    @provider_workspace_id, @provider_task_id, @provider_video_url, @provider_error_code,
    @provider_error_message, @asset_id, @first_last_frame_task_run_id,
    @first_frame_checkpoint_asset_id, @first_frame_checkpoint_revision_id,
    @last_frame_checkpoint_asset_id, @last_frame_checkpoint_revision_id,
    @first_frame_checkpoint_size_bytes, @last_frame_checkpoint_size_bytes,
    @first_frame_asset_id, @last_frame_asset_id, @inputs, @error_message, @created_by,
    @completed_at, @created_at, @updated_at, @real_task_id
);

-- name: VideoGenGet :one
SELECT * FROM canvas_node_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND task_run_id = @id
  AND (NOT @visible_only::bool OR hidden_at IS NULL);

-- name: VideoGenList :many
SELECT * FROM canvas_node_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND node_id = @node_id
  AND hidden_at IS NULL
ORDER BY created_at DESC, task_run_id DESC
LIMIT 100;

-- name: VideoGenHistory :one
SELECT * FROM canvas_node_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND node_id = @node_id
  AND task_run_id = @id
  AND hidden_at IS NULL;

-- name: VideoGenByFrame :one
SELECT * FROM canvas_node_generations
WHERE first_last_frame_task_run_id = @id
  AND hidden_at IS NULL;

-- name: VideoGenByFrameLocked :one
SELECT * FROM canvas_node_generations
WHERE first_last_frame_task_run_id = @id
  AND hidden_at IS NULL
FOR UPDATE;

-- name: VideoGenCheckpointLocked :one
SELECT * FROM canvas_node_generations
WHERE task_run_id = @id
  AND first_last_frame_task_run_id = @frame_task_id
FOR UPDATE;

-- name: VideoGenLocator :one
SELECT source_asset_id, source_revision_id FROM assets
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND id = @id
  AND owner_type = @owner_type
  AND owner_id = @owner_id
  AND media_type = @media_type
  AND deleted_at = 0;

-- name: VideoGenSelect :execrows
UPDATE canvas_nodes
SET resource_id = NULL,
    resource_asset_id = NULL,
    selected_output_id = @run_id,
    selected_asset_id = @asset_id,
    updated_by = @updated_by,
    updated_at = @updated_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND id = @node_id
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND deleted_at = 0;

-- name: VideoGenHide :many
UPDATE canvas_node_generations
SET hidden_at = @hidden_at,
    updated_at = now()
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND node_id = ANY(@ids::text[])
  AND hidden_at IS NULL
RETURNING task_run_id;

-- name: VideoGenUpdate :execrows
UPDATE canvas_node_generations
SET status = @status,
    error_message = @error_message,
    completed_at = @completed_at,
    updated_at = @updated_at,
    asset_id = coalesce(sqlc.narg(asset_id)::text, asset_id)
WHERE task_run_id = @id;

-- name: VideoGenSubmit :execrows
UPDATE canvas_node_generations
SET provider_task_id = @provider_task_id,
    provider_status = @provider_status,
    updated_at = @updated_at
WHERE task_run_id = @id;

-- name: VideoGenAttach :execrows
UPDATE canvas_node_generations
SET first_last_frame_task_run_id = @frame_task_id,
    updated_at = @updated_at
WHERE task_run_id = @id
  AND first_last_frame_task_run_id IS NULL;

-- name: VideoGenObserve :execrows
UPDATE canvas_node_generations
SET provider_status = @status,
    provider_error_code = @error_code,
    provider_error_message = @error_message,
    updated_at = @updated_at,
    provider_video_url = coalesce(sqlc.narg(url)::text, provider_video_url),
    output_duration_seconds = coalesce(sqlc.narg(duration)::int, output_duration_seconds),
    real_task_id = coalesce(sqlc.narg(real_task_id)::text, real_task_id)
WHERE task_run_id = @id;

-- name: VideoGenCheckpoint :execrows
UPDATE canvas_node_generations
SET updated_at = @updated_at,
    first_frame_checkpoint_asset_id = CASE WHEN sqlc.narg(first_asset)::text IS NULL THEN first_frame_checkpoint_asset_id ELSE sqlc.narg(first_asset)::text END,
    first_frame_checkpoint_revision_id = CASE WHEN sqlc.narg(first_asset)::text IS NULL THEN first_frame_checkpoint_revision_id ELSE sqlc.narg(first_revision)::text END,
    first_frame_checkpoint_size_bytes = CASE WHEN sqlc.narg(first_asset)::text IS NULL THEN first_frame_checkpoint_size_bytes ELSE @first_size::bigint END,
    last_frame_checkpoint_asset_id = CASE WHEN sqlc.narg(last_asset)::text IS NULL THEN last_frame_checkpoint_asset_id ELSE sqlc.narg(last_asset)::text END,
    last_frame_checkpoint_revision_id = CASE WHEN sqlc.narg(last_asset)::text IS NULL THEN last_frame_checkpoint_revision_id ELSE sqlc.narg(last_revision)::text END,
    last_frame_checkpoint_size_bytes = CASE WHEN sqlc.narg(last_asset)::text IS NULL THEN last_frame_checkpoint_size_bytes ELSE @last_size::bigint END
WHERE task_run_id = @id
  AND first_last_frame_task_run_id = @frame_task_id
  AND hidden_at IS NULL
  AND first_frame_asset_id IS NULL
  AND last_frame_asset_id IS NULL
  AND (sqlc.narg(first_asset)::text IS NULL OR first_frame_checkpoint_asset_id IS NULL OR (first_frame_checkpoint_asset_id = sqlc.narg(first_asset)::text
  AND first_frame_checkpoint_revision_id = sqlc.narg(first_revision)::text
  AND first_frame_checkpoint_size_bytes = @first_size::bigint))
  AND (sqlc.narg(last_asset)::text IS NULL OR last_frame_checkpoint_asset_id IS NULL OR (last_frame_checkpoint_asset_id = sqlc.narg(last_asset)::text
  AND last_frame_checkpoint_revision_id = sqlc.narg(last_revision)::text
  AND last_frame_checkpoint_size_bytes = @last_size::bigint));

-- name: VideoGenCommitFrames :execrows
UPDATE canvas_node_generations
SET first_frame_asset_id = @first_id,
    last_frame_asset_id = @last_id,
    updated_at = @updated_at
WHERE task_run_id = @id
  AND first_last_frame_task_run_id = @frame_task_id
  AND hidden_at IS NULL
  AND first_frame_asset_id IS NULL
  AND last_frame_asset_id IS NULL
  AND first_frame_checkpoint_asset_id = sqlc.narg(first_asset)::text
  AND first_frame_checkpoint_revision_id = sqlc.narg(first_revision)::text
  AND first_frame_checkpoint_size_bytes = @first_size::bigint
  AND last_frame_checkpoint_asset_id = sqlc.narg(last_asset)::text
  AND last_frame_checkpoint_revision_id = sqlc.narg(last_revision)::text
  AND last_frame_checkpoint_size_bytes = @last_size::bigint;
