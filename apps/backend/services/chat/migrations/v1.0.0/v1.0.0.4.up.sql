ALTER TABLE public.conversations
    DROP COLUMN active_plan_path,
    ADD COLUMN active_plan_file_id character varying(32);

CREATE TABLE public.conversation_files (
    id character varying(32) PRIMARY KEY,
    conversation_id character varying(32) NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id character varying(26) NOT NULL,
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    filename character varying(255) NOT NULL,
    media_type character varying(255) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    sha256 character varying(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    kind character varying(20) DEFAULT 'artifact' NOT NULL CHECK (kind IN ('artifact', 'plan')),
    idempotency_key character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE INDEX ix_conversation_files_conversation
    ON public.conversation_files (conversation_id, created_at);
CREATE INDEX ix_conversation_files_asset_revision
    ON public.conversation_files (asset_id, revision_id);
CREATE UNIQUE INDEX ux_conversation_files_idempotency
    ON public.conversation_files (tenant_id, workspace_id, user_id, conversation_id, idempotency_key);

CREATE TABLE public.asset_claim_intents (
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    owner_type character varying(64) NOT NULL,
    owner_id character varying(128) NOT NULL,
    slot character varying(128) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid,
    kind character varying(20) NOT NULL CHECK (kind IN ('strong', 'snapshot', 'lease', 'weak')),
    generation bigint NOT NULL CHECK (generation > 0),
    desired_state character varying(20) NOT NULL CHECK (desired_state IN ('active', 'released')),
    delivered_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    state_version bigint DEFAULT 1 NOT NULL,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, owner_type, owner_id, slot)
);

CREATE INDEX ix_asset_claim_intents_due
    ON public.asset_claim_intents (delivered_at, next_attempt_at, lease_until);

