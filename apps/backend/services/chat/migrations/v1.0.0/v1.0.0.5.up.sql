ALTER TABLE public.conversation_files
    ADD COLUMN updated_at timestamp with time zone,
    ADD COLUMN content_generation bigint DEFAULT 1 NOT NULL,
    ADD COLUMN content_etag character varying(32),
    ADD COLUMN last_writer_type character varying(20),
    ADD COLUMN last_writer_id character varying(128);

UPDATE public.conversation_files
SET updated_at = created_at,
    content_etag = md5(id || ':' || created_at::text),
    last_writer_type = 'unknown'
WHERE updated_at IS NULL OR content_etag IS NULL OR last_writer_type IS NULL;

ALTER TABLE public.conversation_files
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN content_etag SET NOT NULL,
    ALTER COLUMN last_writer_type SET NOT NULL,
    ADD CONSTRAINT conversation_files_content_generation_check CHECK (content_generation > 0),
    ADD CONSTRAINT conversation_files_last_writer_type_check CHECK (last_writer_type IN ('unknown', 'user', 'agent'));

CREATE TABLE public.conversation_file_save_operations (
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    user_id character varying(26) NOT NULL,
    conversation_id character varying(32) NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    operation_id character varying(80) NOT NULL,
    file_id character varying(32) NOT NULL REFERENCES public.conversation_files(id) ON DELETE CASCADE,
    expected_etag character varying(34) NOT NULL,
    content_sha256 character varying(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
    operation_type character varying(20) NOT NULL CHECK (operation_type = 'update'),
    writer_type character varying(20) NOT NULL CHECK (writer_type IN ('user', 'agent')),
    writer_id character varying(128) NOT NULL,
    status character varying(20) NOT NULL CHECK (status IN ('pending', 'succeeded', 'conflict')),
    lease_until timestamp with time zone,
    result_json jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, user_id, conversation_id, operation_id)
);

CREATE INDEX ix_conversation_file_save_operations_file
    ON public.conversation_file_save_operations (file_id, created_at);
CREATE INDEX ix_conversation_file_save_operations_pending
    ON public.conversation_file_save_operations (status, lease_until)
    WHERE status = 'pending';
