CREATE TABLE conversations (
    id varchar(32) PRIMARY KEY,
    runtime_session_id varchar(32) NOT NULL UNIQUE,
    create_request_id varchar(64) NOT NULL,
    user_id varchar(128) NOT NULL,
    tenant_id varchar(128) NOT NULL,
    workspace_id varchar(128) NOT NULL,
    title varchar(200) NOT NULL DEFAULT '新对话',
    project_id varchar(36),
    canvas_id varchar(36),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE INDEX ix_conversations_scope_updated
    ON conversations (tenant_id, workspace_id, user_id, updated_at DESC);

CREATE UNIQUE INDEX ux_conversations_create_request
    ON conversations (tenant_id, workspace_id, user_id, create_request_id);

CREATE UNIQUE INDEX ux_conversations_canvas_owner
    ON conversations (tenant_id, workspace_id, user_id, project_id, canvas_id)
    WHERE project_id IS NOT NULL AND canvas_id IS NOT NULL;
