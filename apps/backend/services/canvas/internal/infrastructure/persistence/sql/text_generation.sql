-- name: TextGenCreate :exec
INSERT INTO canvas_text_generations (
    task_run_id, tenant_id, workspace_id, project_id, canvas_id, node_id, created_by, prompt,
    model_service_id, inputs, content, status, error_code, error_message, created_at,
    updated_at
) VALUES (
    @task_run_id, @tenant_id, @workspace_id, @project_id, @canvas_id, @node_id, @created_by,
    @prompt, @model_service_id, @inputs, @content, @status, '', '', @created_at, @updated_at
);

-- name: TextGenGet :one
SELECT * FROM canvas_text_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND task_run_id = @task_run_id;

-- name: TextGenGetHistory :one
SELECT * FROM canvas_text_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND task_run_id = @task_run_id
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND node_id = @node_id;

-- name: TextGenList :many
SELECT * FROM canvas_text_generations
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND project_id = @project_id
  AND canvas_id = @canvas_id
  AND node_id = @node_id
ORDER BY created_at DESC, task_run_id DESC
LIMIT 100;

-- name: TextGenStart :execrows
UPDATE canvas_text_generations
SET status = 'running',
    updated_at = @updated_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND task_run_id = @task_run_id
  AND status = 'queued';

-- name: TextGenAppend :execrows
UPDATE canvas_text_generations
SET content = content || @delta::text,
    updated_at = @updated_at
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND task_run_id = @task_run_id
  AND status = 'running'
  AND octet_length(content)::bigint = @expected_offset::bigint;

-- name: TextGenFinish :execrows
UPDATE canvas_text_generations
SET status = @status::varchar,
    updated_at = @updated_at,
    finished_at = @updated_at,

    error_code = coalesce(sqlc.narg(error_code)::text, error_code),
    error_message = coalesce(sqlc.narg(error_message)::text, error_message),

    content = CASE WHEN @status::varchar = 'succeeded' THEN @content ELSE content END
WHERE tenant_id = @tenant_id
  AND workspace_id IS NOT DISTINCT FROM sqlc.narg(workspace_id)::varchar
  AND created_by = @created_by
  AND task_run_id = @task_run_id
  AND status IN ('running', 'queued');
