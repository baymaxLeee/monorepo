ALTER TABLE public.conversations
    ADD COLUMN execution_mode character varying(20) DEFAULT 'cloud' NOT NULL,
    ADD CONSTRAINT conversations_execution_mode_check CHECK (execution_mode IN ('local', 'cloud'));

ALTER TABLE public.conversation_files
    ADD COLUMN workspace_path character varying(1024),
    ADD COLUMN workspace_state character varying(20) DEFAULT 'live' NOT NULL,
    ADD COLUMN path_generation bigint DEFAULT 1 NOT NULL,
    ADD CONSTRAINT conversation_files_workspace_state_check CHECK (workspace_state IN ('live', 'deleted')),
    ADD CONSTRAINT conversation_files_path_generation_check CHECK (path_generation > 0);

CREATE INDEX ix_conversation_files_workspace_path_backfill
    ON public.conversation_files (conversation_id, created_at, id)
    WHERE workspace_path IS NULL;

-- workspace_path remains nullable until the service-owned deterministic
-- backfill has completed and verified every existing Asset/revision reference.
-- A later cutover step adds the live-path uniqueness and NOT NULL constraints.
