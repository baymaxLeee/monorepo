-- name: BeginCanvasProjectionCapture :exec
SELECT set_config('canvas.projection_changes','{}',true);

-- name: ChangedCanvasScopes :many
SELECT c.tenant_id,c.workspace_id,c.project_id,c.id AS canvas_id
FROM jsonb_object_keys(current_setting('canvas.projection_changes')::jsonb) AS changed(id)
JOIN canvases c ON c.id=changed.id::char(36) AND c.deleted_at=0
JOIN projects p ON p.id=c.project_id AND p.deleted_at=0
  AND p.tenant_id=c.tenant_id AND p.workspace_id IS NOT DISTINCT FROM c.workspace_id
ORDER BY c.id;

-- name: LockEventHead :one
SELECT sequence,data FROM canvas_event_heads WHERE canvas_id=$1 FOR UPDATE;

-- name: InsertCanvasEvent :exec
INSERT INTO canvas_events(canvas_id,sequence,data,created_at) VALUES($1,$2,$3,$4);

-- name: SaveEventHead :exec
INSERT INTO canvas_event_heads(canvas_id,sequence,data,updated_at) VALUES($1,$2,$3,$4)
ON CONFLICT (canvas_id) DO UPDATE SET sequence=EXCLUDED.sequence,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at;

-- name: GetEventHead :one
SELECT sequence,data FROM canvas_event_heads WHERE canvas_id=$1;

-- name: ScopedEventCursor :one
SELECT h.sequence FROM canvas_event_heads h
JOIN canvases c ON c.id=h.canvas_id AND c.deleted_at=0
JOIN projects p ON p.id=c.project_id AND p.deleted_at=0
WHERE h.canvas_id=sqlc.arg(canvas_id) AND p.id=sqlc.arg(project_id)
  AND c.tenant_id=sqlc.arg(tenant_id) AND p.tenant_id=c.tenant_id
  AND c.workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND p.workspace_id IS NOT DISTINCT FROM c.workspace_id;

-- name: ListCanvasEvents :many
SELECT sequence,data FROM canvas_events WHERE canvas_id=$1 AND sequence>$2 ORDER BY sequence LIMIT CASE WHEN sqlc.arg(page_size)::bigint >= 0 THEN sqlc.arg(page_size)::bigint END;

-- name: PruneCanvasEvents :exec
DELETE FROM canvas_events WHERE created_at<$1;

-- name: JournalTasks :many
SELECT id,subject_id,status,COALESCE(error_code,'')::text AS error_code,
       COALESCE(error_message,'')::text AS error_message,run_type
FROM task_runs WHERE tenant_id=$1 AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND subject_id=ANY(sqlc.arg(node_ids)::varchar[]) AND hidden_at IS NULL AND parent_task_id IS NULL
ORDER BY created_at DESC,id DESC;

-- name: JournalVideoFacts :many
SELECT task_run_id,COALESCE(provider_status,'')::text AS provider_status,
       COALESCE(provider_task_id,'')::text AS provider_task_id,
       COALESCE(provider_error_code,'')::text AS provider_error_code
FROM canvas_node_generations WHERE canvas_id=$1 AND node_id=ANY(sqlc.arg(node_ids)::varchar[]) AND hidden_at IS NULL;

-- name: JournalTexts :many
SELECT node_id,task_run_id,content,status FROM canvas_text_generations
WHERE canvas_id=$1 AND node_id=ANY(sqlc.arg(node_ids)::varchar[]) ORDER BY created_at DESC,task_run_id DESC;
