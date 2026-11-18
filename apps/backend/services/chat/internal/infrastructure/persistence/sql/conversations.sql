-- name: CreateConversation :one
INSERT INTO conversations (
    id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
ON CONFLICT DO NOTHING
RETURNING id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at;

-- name: FindConversationByIdempotency :one
SELECT id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at
FROM conversations
WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
    AND (create_request_id = $4 OR (
        sqlc.narg(project_id)::varchar IS NOT NULL
        AND sqlc.narg(canvas_id)::varchar IS NOT NULL
        AND project_id = sqlc.narg(project_id)::varchar
        AND canvas_id = sqlc.narg(canvas_id)::varchar
    ))
LIMIT 1;

-- name: ListConversations :many
SELECT id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at
FROM conversations
WHERE user_id = $1 AND tenant_id = $2 AND workspace_id = $3
ORDER BY updated_at DESC;

-- name: GetConversation :one
SELECT id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at
FROM conversations
WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND workspace_id = $4;

-- name: UpdateConversationTitle :one
UPDATE conversations SET title = $1, updated_at = NOW()
WHERE id = $2 AND user_id = $3 AND tenant_id = $4 AND workspace_id = $5
RETURNING id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at;

-- name: UpdateConversationTitleIfDefault :one
UPDATE conversations SET title = $1, updated_at = NOW()
WHERE id = $2 AND user_id = $3 AND tenant_id = $4 AND workspace_id = $5
    AND (btrim(title) = '' OR title = '新对话')
RETURNING id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at;

-- name: DeleteConversation :one
DELETE FROM conversations
WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND workspace_id = $4
RETURNING id, runtime_session_id, create_request_id, user_id, tenant_id, workspace_id,
    title, project_id, canvas_id, created_at, updated_at;
