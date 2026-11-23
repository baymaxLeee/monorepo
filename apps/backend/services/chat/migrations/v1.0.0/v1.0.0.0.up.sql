-- Chat v1.0.0 fresh-install baseline.
-- Chat owns product metadata and a durable mapping saga only. Runtime owns the
-- Thread journal, Turns, Items, tools, files, approvals and execution state.

CREATE TABLE conversations (
    id varchar(32) PRIMARY KEY,
    state varchar(20) NOT NULL DEFAULT 'creating',
    operation varchar(20) NOT NULL,
    runtime_thread_id varchar(32) UNIQUE,
    create_request_id varchar(64) NOT NULL,
    create_fingerprint varchar(64) NOT NULL,
    runtime_request jsonb NOT NULL,
    source_conversation_id varchar(32),
    source_message_id varchar(32),
    user_id varchar(128) NOT NULL,
    tenant_id varchar(128) NOT NULL,
    workspace_id varchar(128) NOT NULL,
    title varchar(200) NOT NULL DEFAULT '新对话',
    plugin_selections_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL,
    last_error text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT conversations_state_check CHECK (state IN ('creating', 'ready', 'deleting')),
    CONSTRAINT conversations_operation_check CHECK (operation IN ('create', 'fork')),
    CONSTRAINT conversations_plugin_selections_check CHECK (
        jsonb_typeof(plugin_selections_json) = 'array'
        AND jsonb_array_length(plugin_selections_json) <= 16
    ),
    CONSTRAINT conversations_runtime_binding_check CHECK (
        (state = 'creating') OR runtime_thread_id IS NOT NULL
    ),
    CONSTRAINT conversations_fork_source_check CHECK (
        (operation = 'create' AND source_conversation_id IS NULL AND source_message_id IS NULL)
        OR (operation = 'fork' AND source_conversation_id IS NOT NULL AND source_message_id IS NOT NULL)
    )
);

CREATE INDEX ix_conversations_scope_updated
    ON conversations (tenant_id, workspace_id, user_id, updated_at DESC)
    WHERE state = 'ready';

CREATE INDEX ix_conversations_reconcile
    ON conversations (state, next_attempt_at, created_at)
    WHERE state IN ('creating', 'deleting');

CREATE UNIQUE INDEX ux_conversations_create_request
    ON conversations (tenant_id, workspace_id, user_id, create_request_id);

-- Product memory belongs to Chat's authenticated business scope. Runtime only
-- receives the selected memory content in a frozen Turn capability.
CREATE TABLE user_memories (
    id varchar(32) PRIMARY KEY,
    tenant_id varchar(128) NOT NULL,
    workspace_id varchar(128) NOT NULL,
    user_id varchar(128) NOT NULL,
    category varchar(40) NOT NULL,
    content text NOT NULL,
    source varchar(80) NOT NULL DEFAULT 'agent',
    confidence integer NOT NULL DEFAULT 80 CHECK (confidence BETWEEN 0 AND 100),
    status varchar(20) NOT NULL DEFAULT 'active',
    reason text,
    origin_turn_id varchar(32),
    supersedes_id varchar(32),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT user_memories_category_check CHECK (
        category IN ('preference', 'profile', 'project', 'instruction')
    ),
    CONSTRAINT user_memories_status_check CHECK (
        status IN ('pending', 'active', 'rejected', 'superseded')
    )
);

CREATE INDEX ix_user_memories_scope_status
    ON user_memories (tenant_id, workspace_id, user_id, status, created_at);
