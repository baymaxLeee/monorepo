-- name: ReserveConversation :one
INSERT INTO conversations (
    id, state, operation, runtime_thread_id, create_request_id, create_fingerprint,
    runtime_request, source_conversation_id, source_message_id,
    user_id, tenant_id, workspace_id, title, plugin_selections_json,
    attempt_count, next_attempt_at, last_error, created_at, updated_at
) VALUES (
    $1, 'creating', $2, NULL, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, 0, $13, NULL, $13, $13
)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: FindConversationByIdempotency :one
SELECT *
FROM conversations
WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
    AND create_request_id = $4
LIMIT 1;

-- name: BindConversationRuntimeThread :one
UPDATE conversations
SET runtime_thread_id = $1,
    state = 'ready',
    attempt_count = attempt_count + 1,
    next_attempt_at = $2,
    last_error = NULL,
    updated_at = $2
WHERE id = $3 AND user_id = $4 AND tenant_id = $5 AND workspace_id = $6
    AND (
        (state = 'creating' AND (runtime_thread_id IS NULL OR runtime_thread_id = $1))
        OR (state = 'ready' AND runtime_thread_id = $1)
    )
RETURNING *;

-- name: RecordConversationSagaFailure :one
UPDATE conversations
SET attempt_count = attempt_count + 1,
    next_attempt_at = $1 + (
        LEAST(300, power(2, LEAST(attempt_count, 8))::integer) * INTERVAL '1 second'
    ),
    last_error = $2,
    updated_at = $1
WHERE id = $3 AND user_id = $4 AND tenant_id = $5 AND workspace_id = $6
    AND state = $7
RETURNING *;

-- name: ListConversations :many
SELECT *
FROM conversations
WHERE user_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND state = 'ready'
ORDER BY updated_at DESC;

-- name: GetConversation :one
SELECT *
FROM conversations
WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND workspace_id = $4;

-- name: UpdateConversationTitle :one
UPDATE conversations SET title = $1, updated_at = NOW()
WHERE id = $2 AND user_id = $3 AND tenant_id = $4 AND workspace_id = $5 AND state = 'ready'
RETURNING *;

-- name: UpdateConversationTitleIfDefault :one
UPDATE conversations SET title = $1, updated_at = NOW()
WHERE id = $2 AND user_id = $3 AND tenant_id = $4 AND workspace_id = $5
    AND state = 'ready' AND (btrim(title) = '' OR title = '新对话')
RETURNING *;

-- name: BeginConversationDelete :one
UPDATE conversations
SET state = 'deleting', next_attempt_at = $1, last_error = NULL, updated_at = $1
WHERE id = $2 AND user_id = $3 AND tenant_id = $4 AND workspace_id = $5
    AND state IN ('ready', 'deleting') AND runtime_thread_id IS NOT NULL
RETURNING *;

-- name: CompleteConversationDelete :one
DELETE FROM conversations
WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND workspace_id = $4
    AND state = 'deleting' AND runtime_thread_id = $5
RETURNING *;
