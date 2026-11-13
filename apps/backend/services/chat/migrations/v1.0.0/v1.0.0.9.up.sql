-- Local inference records contain authorization/accounting metadata only.
-- No local conversation, prompt, tool result or file content is stored here.
CREATE TABLE local_inference_budgets (
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    user_id varchar(26) NOT NULL,
    day date NOT NULL,
    used_tokens bigint NOT NULL CHECK (used_tokens >= 0),
    PRIMARY KEY (tenant_id, workspace_id, user_id, day)
);
CREATE TABLE local_inference_requests (
    id uuid PRIMARY KEY,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    user_id varchar(26) NOT NULL,
    day date NOT NULL,
    model varchar(200) NOT NULL,
    reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
    charged_tokens bigint NOT NULL CHECK (charged_tokens >= 0),
    status varchar(20) NOT NULL CHECK (status IN ('admitted', 'completed', 'unknown')),
    deadline timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, workspace_id, user_id, day)
        REFERENCES local_inference_budgets (tenant_id, workspace_id, user_id, day)
);
CREATE INDEX ix_local_inference_active ON local_inference_requests (tenant_id,workspace_id,user_id,deadline)
    WHERE status = 'admitted';
