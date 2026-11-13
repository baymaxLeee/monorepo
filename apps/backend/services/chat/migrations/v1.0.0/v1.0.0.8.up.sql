DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.conversation_files WHERE workspace_path IS NULL) THEN
        RAISE EXCEPTION 'workspace path backfill and Storage verification must complete before v1.0.0.8';
    END IF;
END $$;

ALTER TABLE public.sandbox_executions
    DROP CONSTRAINT sandbox_executions_state_check,
    DROP CONSTRAINT sandbox_executions_resource_state_check,
    ADD CONSTRAINT sandbox_executions_state_check CHECK (state IN ('restoring', 'active', 'finalizing', 'releasing')),
    ADD CONSTRAINT sandbox_executions_resource_state_check CHECK (
        (state = 'restoring' AND sandbox_id IS NULL AND expires_at IS NULL)
        OR (state IN ('active', 'finalizing', 'releasing'))
    );

ALTER TABLE public.conversation_files
    ALTER COLUMN workspace_path SET NOT NULL,
    ADD CONSTRAINT conversation_files_workspace_path_check CHECK (
        workspace_path LIKE '/workspace/%'
        AND workspace_path !~ E'[\\x00-\\x1f]'
        AND workspace_path !~ '(^|/)\\.{1,2}(/|$)'
    );

ALTER TABLE public.conversation_file_save_operations
    ADD COLUMN workspace_path character varying(1024),
    ADD COLUMN expected_path_generation bigint;

CREATE UNIQUE INDEX ux_conversation_files_live_workspace_path
    ON public.conversation_files (tenant_id, workspace_id, conversation_id, workspace_path)
    WHERE workspace_state = 'live';

DROP INDEX public.ix_conversation_files_workspace_path_backfill;
