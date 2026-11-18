-- name: ArchiveCreate :exec
INSERT INTO canvas_video_archive_exports (
    task_run_id, tenant_id, workspace_id, project_id, canvas_id, status, error_code,
    error_message, input_count, output_filename, output_asset_id, output_revision_id,
    output_size, output_sha256, upload_id, part_size, created_by, retention_started_at,
    retention_guaranteed_until, cleanup_status, cleanup_next_at, cleanup_lease_until,
    cleanup_state_version, cleanup_attempts, cleanup_last_error, started_at, finished_at,
    created_at, updated_at
) VALUES (
    @task_run_id, @tenant_id, @workspace_id, @project_id, @canvas_id, @status, @error_code,
    @error_message, @input_count, @output_filename, @output_asset_id, @output_revision_id,
    @output_size, @output_sha256, @upload_id, @part_size, @created_by, @retention_started_at,
    @retention_guaranteed_until, @cleanup_status, @cleanup_next_at, @cleanup_lease_until,
    @cleanup_state_version, @cleanup_attempts, @cleanup_last_error, @started_at, @finished_at,
    @created_at, @updated_at
);

-- name: ArchiveCreateInputs :exec
INSERT INTO canvas_video_archive_export_inputs (
    task_run_id, inputs, created_at
) VALUES (
    @task_run_id, @inputs, @created_at
);

-- name: ArchiveGet :one
SELECT * FROM canvas_video_archive_exports
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND task_run_id = @id;

-- name: ArchiveByID :one
SELECT * FROM canvas_video_archive_exports
WHERE task_run_id = @id;

-- name: ArchiveBatch :many
SELECT * FROM canvas_video_archive_exports
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND task_run_id = ANY(@ids::text[]);

-- name: ArchiveCount :one
SELECT count(*) FROM canvas_video_archive_exports
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id;

-- name: ArchiveActive :one
SELECT * FROM canvas_video_archive_exports
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND status IN ('queued', 'running')
ORDER BY created_at DESC, task_run_id
LIMIT 1;

-- name: ArchiveListAsc :many
SELECT * FROM canvas_video_archive_exports
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
ORDER BY created_at ASC, task_run_id ASC
LIMIT CASE WHEN @page_size::int >= 0 THEN @page_size::int END
OFFSET greatest(@page_offset::int, 0);

-- name: ArchiveListDesc :many
SELECT * FROM canvas_video_archive_exports
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND canvas_id = @canvas_id
ORDER BY created_at DESC, task_run_id DESC
LIMIT CASE WHEN @page_size::int >= 0 THEN @page_size::int END
OFFSET greatest(@page_offset::int, 0);

-- name: ArchiveInputs :one
SELECT * FROM canvas_video_archive_export_inputs
WHERE task_run_id = @id;

-- name: ArchiveLockCanvas :one
SELECT name FROM canvases
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id
  AND id = @id
  AND deleted_at = 0
FOR UPDATE;

-- name: ArchiveSnapshot :many
SELECT n.id AS node_id, n.selected_output_id AS output_id, n.selected_asset_id AS asset_id,
    a.source_asset_id, a.source_revision_id, coalesce(a.size_bytes, 0)::bigint AS media_size, coalesce(g.status, '')::text AS generation_status
FROM canvas_nodes n LEFT JOIN canvas_node_generations g ON g.task_run_id = n.selected_output_id
  AND g.tenant_id = n.tenant_id
  AND g.workspace_id IS NOT DISTINCT FROM n.workspace_id
  AND g.project_id = n.project_id
  AND g.canvas_id = n.canvas_id
  AND g.node_id = n.id
LEFT JOIN assets a ON a.id = g.asset_id
  AND a.id = n.selected_asset_id
  AND a.tenant_id = g.tenant_id
  AND a.workspace_id IS NOT DISTINCT FROM n.workspace_id
  AND a.owner_type = @owner_type
  AND a.owner_id = n.project_id
  AND a.media_type = @media_type
  AND a.deleted_at = 0
WHERE n.tenant_id = @tenant_id
  AND n.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND n.project_id = @project_id
  AND n.canvas_id = @canvas_id
  AND n.type = @type
  AND n.deleted_at = 0
  AND n.selected_output_id IS NOT NULL
ORDER BY n.storyboard_rank, n.id;

-- name: ArchiveLifecycle :execrows
UPDATE canvas_video_archive_exports
SET status = @status::varchar,
    error_code = @error_code,
    error_message = @error_message,
    updated_at = @updated_at,

    started_at = coalesce(sqlc.narg(started_at)::timestamptz, started_at),
    finished_at = coalesce(sqlc.narg(finished_at)::timestamptz, finished_at),

    cleanup_status = CASE WHEN @status::varchar IN ('failed', 'cancelled')
    AND output_sha256 <> '' THEN 'pending' ELSE cleanup_status END,

    cleanup_next_at = CASE WHEN @status::varchar IN ('failed', 'cancelled')
    AND output_sha256 <> '' THEN @cleanup_next_at ELSE cleanup_next_at END
WHERE task_run_id = @id
  AND status = @expected;

-- name: ArchiveOutput :execrows
UPDATE canvas_video_archive_exports
SET output_asset_id = @output_asset_id,
    output_revision_id = @output_revision_id,
    output_size = @output_size,
    output_sha256 = @output_sha256,
    upload_id = @upload_id,
    part_size = @part_size,
    retention_started_at = @retention_started_at,
    updated_at = @updated_at
WHERE task_run_id = @id
  AND status = @expected
  AND output_asset_id = ''
  AND output_revision_id = '';

-- name: ArchiveSuccess :execrows
UPDATE canvas_video_archive_exports
SET output_asset_id = @output_asset_id,
    output_revision_id = @output_revision_id,
    output_size = @output_size,
    output_sha256 = @output_sha256,
    upload_id = @upload_id,
    part_size = @part_size,
    retention_started_at = @retention_started_at,
    updated_at = @updated_at,
    status = 'succeeded',
    retention_guaranteed_until = @until,
    cleanup_status = 'pending',
    cleanup_next_at = @until,
    finished_at = @updated_at
WHERE task_run_id = @id
  AND status = @expected;

-- name: ArchiveDue :many
SELECT * FROM canvas_video_archive_exports
WHERE cleanup_status = 'pending'
  AND cleanup_next_at <= @now
  AND (cleanup_lease_until IS NULL OR cleanup_lease_until <= @now)
ORDER BY cleanup_next_at, task_run_id
LIMIT @page_size
FOR UPDATE SKIP LOCKED;

-- name: ArchiveClaim :execrows
UPDATE canvas_video_archive_exports
SET cleanup_lease_until = @lease_until,
    cleanup_state_version = cleanup_state_version + 1,
    updated_at = @updated_at
WHERE task_run_id = @id
  AND cleanup_state_version = @version
  AND cleanup_status = 'pending';

-- name: ArchiveComplete :execrows
UPDATE canvas_video_archive_exports
SET cleanup_status = 'completed',
    cleanup_lease_until = NULL,
    cleanup_state_version = cleanup_state_version + 1,
    updated_at = @updated_at
WHERE task_run_id = @id
  AND cleanup_state_version = @version
  AND cleanup_status = 'pending';

-- name: ArchiveReschedule :execrows
UPDATE canvas_video_archive_exports
SET cleanup_next_at = @next,
    cleanup_lease_until = NULL,
    cleanup_attempts = cleanup_attempts + 1,
    cleanup_last_error = @message,
    cleanup_state_version = cleanup_state_version + 1,
    updated_at = @updated_at
WHERE task_run_id = @id
  AND cleanup_state_version = @version
  AND cleanup_status = 'pending';
