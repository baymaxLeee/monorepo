-- name: EnqueueCanvasDeletionJob :exec
INSERT INTO deletion_jobs (id, tenant_id, kind, payload, next_attempt_at, state_version, attempts, last_error, created_at, updated_at)
VALUES (@id, @tenant_id, @kind, @payload, @next_attempt_at, 1, 0, '', now(), now())
ON CONFLICT (id) DO NOTHING;

-- name: DeletionNodes :many
SELECT id, project_id, canvas_id, revision FROM canvas_nodes
WHERE tenant_id = @tenant_id AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND id = ANY(@ids::varchar[]);

-- name: DeletionNodeRuns :many
SELECT id, subject_id, created_by, run_type FROM task_runs
WHERE tenant_id = @tenant_id AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND subject_type = 'CANVAS_NODE' AND subject_id = ANY(@ids::varchar[])
  AND run_type IN ('CANVAS_NODE_VIDEO_GENERATION','CANVAS_NODE_TEXT_GENERATION','CANVAS_STORYBOARD_GENERATION');

-- name: DeletionCanvases :many
SELECT id FROM canvases
WHERE tenant_id = @tenant_id AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id AND (@canvas_id::varchar = '' OR id = @canvas_id);

-- name: DeletionArchiveRuns :many
SELECT id, subject_id AS canvas_id, created_by, run_type FROM task_runs
WHERE tenant_id = @tenant_id AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND subject_id = ANY(@ids::varchar[]) AND subject_type = 'CANVAS' AND run_type = 'CANVAS_VIDEO_ARCHIVE_EXPORT';

-- name: DeletionStoryboardRuns :many
SELECT t.id, n.canvas_id, t.created_by, t.run_type FROM task_runs t
JOIN canvas_nodes n ON n.id = t.subject_id
WHERE t.tenant_id = @tenant_id AND t.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND t.subject_type = 'CANVAS_NODE' AND t.run_type = 'CANVAS_STORYBOARD_GENERATION'
  AND n.canvas_id = ANY(@ids::varchar[]);

-- name: HideCanvasDeletionRuns :exec
UPDATE task_runs SET hidden_at = @now::pg_catalog.timestamptz, updated_at = @now, state_version = state_version + 1
WHERE tenant_id = @tenant_id AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND id = ANY(@ids::varchar[]) AND hidden_at IS NULL;

-- name: ExpireCanvasDeletionArchives :exec
UPDATE canvas_video_archive_exports SET cleanup_next_at = @now::pg_catalog.timestamptz, retention_guaranteed_until = @now, updated_at = @now
WHERE tenant_id = @tenant_id AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND project_id = @project_id AND canvas_id = ANY(@ids::varchar[]) AND cleanup_status = 'PENDING';

-- name: ExpireDeletedTaskArchive :exec
UPDATE canvas_video_archive_exports SET cleanup_next_at = @now::pg_catalog.timestamptz, retention_guaranteed_until = @now, updated_at = @now
WHERE task_run_id = @id AND cleanup_status = 'PENDING';
