CREATE TABLE public.sandbox_executions (
    run_id character varying(32) PRIMARY KEY REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    conversation_id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    state character varying(20) NOT NULL CHECK (state IN ('restoring', 'active', 'releasing')),
    sandbox_id character varying(128),
    expires_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT sandbox_executions_resource_state_check CHECK (
        (state = 'restoring' AND sandbox_id IS NULL AND expires_at IS NULL)
        OR (state IN ('active', 'releasing'))
    )
);

CREATE INDEX ix_sandbox_executions_releasing
    ON public.sandbox_executions (state, updated_at);
