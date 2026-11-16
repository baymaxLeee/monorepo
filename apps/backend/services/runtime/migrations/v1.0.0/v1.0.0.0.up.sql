-- Canonical reinstall-only schema baseline. See ADR-0073.
-- The migration runner owns the migration table and version/checksum update.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;




SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.agent_runs (
    id character varying(32) NOT NULL,
    session_id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    provider_id character varying(32) DEFAULT ''::character varying NOT NULL,
    model character varying(120) DEFAULT ''::character varying NOT NULL,
    status character varying(20) NOT NULL,
    error text,
    input_message_id character varying(32),
    output_message_id character varying(32),
    total_tokens integer,
    created_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    input_tokens integer,
    output_tokens integer,
    cached_input_tokens integer,
    reasoning_tokens integer
);



CREATE TABLE public.agent_steps (
    id character varying(32) NOT NULL,
    run_id character varying(32) NOT NULL,
    step_index integer NOT NULL,
    kind character varying(32) NOT NULL,
    status character varying(20) NOT NULL,
    summary text,
    metadata jsonb,
    created_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    input_tokens integer,
    output_tokens integer,
    total_tokens integer
);



CREATE TABLE public.agent_tool_calls (
    id character varying(64) NOT NULL,
    run_id character varying(32) NOT NULL,
    step_index integer,
    tool_name character varying(80) NOT NULL,
    status character varying(20) NOT NULL,
    input_json jsonb,
    output_json jsonb,
    error text,
    duration_ms integer,
    created_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone
);



CREATE TABLE public.session_artifact_cleanup_outbox (
    session_id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) DEFAULT 'system-tenant'::character varying NOT NULL
);



CREATE TABLE public.session_contexts (
    session_id character varying(32) NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    covered_through_message_id character varying(32),
    summary text NOT NULL,
    state_json jsonb NOT NULL,
    estimated_tokens integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.session_run_leases (
    session_id character varying(32) NOT NULL,
    run_id character varying(32) NOT NULL,
    heartbeat_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL
);



CREATE TABLE public.sessions (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    model character varying(120) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    provider_id character varying(32) DEFAULT ''::character varying NOT NULL,
    workspace_id character varying(26) NOT NULL,
    active_plan_path character varying(512),
    tenant_id character varying(26) DEFAULT 'system-tenant'::character varying NOT NULL,
    create_request_id character varying(64) NOT NULL
);



CREATE TABLE public.messages (
    id character varying(32) NOT NULL,
    session_id character varying(32) NOT NULL,
    role character varying(20) NOT NULL,
    content jsonb NOT NULL,
    status character varying(20) DEFAULT 'ok'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL
);



CREATE TABLE public.user_memories (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    category character varying(40) NOT NULL,
    content text NOT NULL,
    source character varying(80) DEFAULT 'agent'::character varying NOT NULL,
    confidence integer DEFAULT 80 NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    reason text,
    origin_run_id character varying(32),
    supersedes_id character varying(32)
);



ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT agent_steps_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_tool_calls
    ADD CONSTRAINT agent_tool_calls_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.session_artifact_cleanup_outbox
    ADD CONSTRAINT session_artifact_cleanup_outbox_pkey PRIMARY KEY (session_id);



ALTER TABLE ONLY public.session_contexts
    ADD CONSTRAINT session_contexts_pkey PRIMARY KEY (session_id);



ALTER TABLE ONLY public.session_run_leases
    ADD CONSTRAINT session_run_leases_pkey PRIMARY KEY (session_id);



ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.user_memories
    ADD CONSTRAINT user_memories_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.session_run_leases
    ADD CONSTRAINT ux_session_run_leases_run_id UNIQUE (run_id);



CREATE INDEX ix_agent_runs_session_id ON public.agent_runs USING btree (session_id);



CREATE INDEX ix_agent_runs_user_id ON public.agent_runs USING btree (user_id);



CREATE INDEX ix_agent_steps_run_id ON public.agent_steps USING btree (run_id);



CREATE INDEX ix_agent_steps_run_step ON public.agent_steps USING btree (run_id, step_index);



CREATE INDEX ix_agent_tool_calls_run_id ON public.agent_tool_calls USING btree (run_id);



CREATE INDEX ix_agent_tool_calls_tool_name ON public.agent_tool_calls USING btree (tool_name);



CREATE INDEX ix_session_artifact_cleanup_outbox_available ON public.session_artifact_cleanup_outbox USING btree (available_at, created_at);



CREATE INDEX ix_sessions_user_id ON public.sessions USING btree (user_id);



CREATE INDEX ix_sessions_user_org ON public.sessions USING btree (user_id, workspace_id);



CREATE INDEX ix_messages_session_id ON public.messages USING btree (session_id);



CREATE INDEX ix_user_memories_user_id ON public.user_memories USING btree (user_id);



CREATE INDEX ix_user_memories_user_status ON public.user_memories USING btree (user_id, status);



CREATE UNIQUE INDEX ux_sessions_create_request ON public.sessions USING btree (tenant_id, workspace_id, user_id, create_request_id);



ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT fk_agent_runs_session_id FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT fk_agent_steps_run_id FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_tool_calls
    ADD CONSTRAINT fk_agent_tool_calls_run_id FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.session_contexts
    ADD CONSTRAINT fk_session_contexts_session_id FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.session_run_leases
    ADD CONSTRAINT fk_session_run_leases_session_id FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.session_run_leases
    ADD CONSTRAINT fk_session_run_leases_run_id FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_session_id FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

ALTER TABLE public.sessions
    ADD COLUMN run_revision bigint NOT NULL DEFAULT 0;

-- Every lease writer, including an older Chat instance during rollout, takes
-- the same session row lock and invalidates in-flight fork snapshots.
CREATE FUNCTION public.advance_session_run_revision() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.sessions
    SET run_revision = run_revision + 1
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER session_run_lease_revision
    BEFORE INSERT ON public.session_run_leases
    FOR EACH ROW EXECUTE FUNCTION public.advance_session_run_revision();

-- consolidated from v1.0.0.2
-- Native UIMessage journal branches and idempotent run operations.
-- Existing linear histories are backfilled into a single selected path.

ALTER TABLE public.sessions
    ADD COLUMN history_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN selected_message_id character varying(32);

ALTER TABLE public.messages
    ADD COLUMN parent_message_id character varying(32),
    ADD COLUMN branch_index integer NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT id,
           lag(id) OVER (PARTITION BY session_id ORDER BY created_at, id) AS parent_message_id
    FROM public.messages
)
UPDATE public.messages AS message
SET parent_message_id = ordered.parent_message_id
FROM ordered
WHERE ordered.id = message.id;

WITH leaves AS (
    SELECT DISTINCT ON (session_id) session_id, id
    FROM public.messages
    ORDER BY session_id, created_at DESC, id DESC
)
UPDATE public.sessions AS session
SET selected_message_id = leaves.id
FROM leaves
WHERE leaves.session_id = session.id;

ALTER TABLE public.messages
    ADD CONSTRAINT messages_parent_message_id_fkey
    FOREIGN KEY (parent_message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX ux_messages_sibling_branch
    ON public.messages (session_id, COALESCE(parent_message_id, ''), branch_index);
CREATE INDEX ix_messages_parent_message_id ON public.messages(parent_message_id);

ALTER TABLE public.agent_runs
    ADD COLUMN request_id character varying(64),
    ADD COLUMN operation character varying(32),
    ADD COLUMN target_message_id character varying(32),
    ADD COLUMN history_message_id character varying(32),
    ADD COLUMN history_revision bigint;

CREATE UNIQUE INDEX ux_agent_runs_session_request
    ON public.agent_runs(session_id, request_id)
    WHERE request_id IS NOT NULL;
CREATE INDEX ix_agent_runs_history_message_id ON public.agent_runs(history_message_id);

ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_operation_check
    CHECK (operation IS NULL OR operation IN ('submit-message', 'edit-message', 'regenerate-message', 'tool-continuation'));

-- consolidated from v1.0.0.3
-- Bind retries to the complete logical operation; existing journal rows are preserved.
ALTER TABLE public.agent_runs ADD COLUMN request_fingerprint varchar(64);

-- consolidated from v1.0.0.4
ALTER TABLE public.sessions
    DROP COLUMN active_plan_path,
    ADD COLUMN active_plan_file_id character varying(32);

CREATE TABLE public.session_files (
    id character varying(32) PRIMARY KEY,
    session_id character varying(32) NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
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

CREATE INDEX ix_session_files_session
    ON public.session_files (session_id, created_at);
CREATE INDEX ix_session_files_asset_revision
    ON public.session_files (asset_id, revision_id);
CREATE UNIQUE INDEX ux_session_files_idempotency
    ON public.session_files (tenant_id, workspace_id, user_id, session_id, idempotency_key);

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


-- consolidated from v1.0.0.5
ALTER TABLE public.session_files
    ADD COLUMN updated_at timestamp with time zone,
    ADD COLUMN content_generation bigint DEFAULT 1 NOT NULL,
    ADD COLUMN content_etag character varying(32),
    ADD COLUMN last_writer_type character varying(20),
    ADD COLUMN last_writer_id character varying(128);

UPDATE public.session_files
SET updated_at = created_at,
    content_etag = md5(id || ':' || created_at::text),
    last_writer_type = 'unknown'
WHERE updated_at IS NULL OR content_etag IS NULL OR last_writer_type IS NULL;

ALTER TABLE public.session_files
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN content_etag SET NOT NULL,
    ALTER COLUMN last_writer_type SET NOT NULL,
    ADD CONSTRAINT session_files_content_generation_check CHECK (content_generation > 0),
    ADD CONSTRAINT session_files_last_writer_type_check CHECK (last_writer_type IN ('unknown', 'user', 'agent'));

CREATE TABLE public.session_file_save_operations (
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    user_id character varying(26) NOT NULL,
    session_id character varying(32) NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    operation_id character varying(80) NOT NULL,
    file_id character varying(32) NOT NULL REFERENCES public.session_files(id) ON DELETE CASCADE,
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
    PRIMARY KEY (tenant_id, workspace_id, user_id, session_id, operation_id)
);

CREATE INDEX ix_session_file_save_operations_file
    ON public.session_file_save_operations (file_id, created_at);
CREATE INDEX ix_session_file_save_operations_pending
    ON public.session_file_save_operations (status, lease_until)
    WHERE status = 'pending';

-- consolidated from v1.0.0.6
CREATE TABLE public.sandbox_executions (
    run_id character varying(32) PRIMARY KEY REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    session_id character varying(32) NOT NULL,
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

-- consolidated from v1.0.0.7
ALTER TABLE public.sessions
    ADD COLUMN execution_mode character varying(20) DEFAULT 'cloud' NOT NULL,
    ADD CONSTRAINT sessions_execution_mode_check CHECK (execution_mode IN ('local', 'cloud'));

ALTER TABLE public.session_files
    ADD COLUMN workspace_path character varying(1024),
    ADD COLUMN workspace_state character varying(20) DEFAULT 'live' NOT NULL,
    ADD COLUMN path_generation bigint DEFAULT 1 NOT NULL,
    ADD CONSTRAINT session_files_workspace_state_check CHECK (workspace_state IN ('live', 'deleted')),
    ADD CONSTRAINT session_files_path_generation_check CHECK (path_generation > 0);

CREATE INDEX ix_session_files_workspace_path_backfill
    ON public.session_files (session_id, created_at, id)
    WHERE workspace_path IS NULL;

-- workspace_path remains nullable until the service-owned deterministic
-- backfill has completed and verified every existing Asset/revision reference.
-- A later cutover step adds the live-path uniqueness and NOT NULL constraints.

-- consolidated from v1.0.0.8
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.session_files WHERE workspace_path IS NULL) THEN
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

ALTER TABLE public.session_files
    ALTER COLUMN workspace_path SET NOT NULL,
    ADD CONSTRAINT session_files_workspace_path_check CHECK (
        workspace_path LIKE '/workspace/%'
        AND workspace_path !~ E'[\\x00-\\x1f]'
        AND workspace_path !~ '(^|/)\\.{1,2}(/|$)'
    );

ALTER TABLE public.session_file_save_operations
    ADD COLUMN workspace_path character varying(1024),
    ADD COLUMN expected_path_generation bigint;

CREATE UNIQUE INDEX ux_session_files_live_workspace_path
    ON public.session_files (tenant_id, workspace_id, session_id, workspace_path)
    WHERE workspace_state = 'live';

DROP INDEX public.ix_session_files_workspace_path_backfill;

-- consolidated from v1.0.0.9
-- Local inference records contain authorization/accounting metadata only.
-- No local session, prompt, tool result or file content is stored here.
CREATE TABLE public.local_inference_budgets (
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    user_id varchar(26) NOT NULL,
    day date NOT NULL,
    used_tokens bigint NOT NULL CHECK (used_tokens >= 0),
    PRIMARY KEY (tenant_id, workspace_id, user_id, day)
);
CREATE TABLE public.local_inference_requests (
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
        REFERENCES public.local_inference_budgets (tenant_id, workspace_id, user_id, day)
);
CREATE INDEX ix_local_inference_active ON public.local_inference_requests (tenant_id,workspace_id,user_id,deadline)
    WHERE status = 'admitted';

-- consolidated from v1.0.0.10
CREATE TABLE public.agent_steering_inputs (
    run_id varchar(32) NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    client_message_id varchar(64) NOT NULL,
    session_id varchar(32) NOT NULL,
    delivery varchar(20) NOT NULL CHECK (delivery IN ('steer', 'queue')),
    text text NOT NULL,
    state varchar(20) NOT NULL CHECK (state IN ('accepted', 'dispatching', 'delivered', 'not_delivered', 'unconfirmed')),
    step_number integer,
    reason text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (run_id, client_message_id)
);
CREATE INDEX ix_agent_steering_inputs_pending ON public.agent_steering_inputs (run_id,state,created_at);

-- Detached durable Job and video production state owned by Runtime worker.
-- Canonical reinstall-only schema baseline. See ADR-0073.
-- The migration runner owns the migration table and version/checksum update.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;




SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.tasks (
    id character varying(32) NOT NULL,
    type character varying(64) NOT NULL,
    status character varying(20) NOT NULL,
    owner_service character varying(40) NOT NULL,
    owner_ref character varying(80) NOT NULL,
    workflow_run_id character varying(64),
    payload jsonb NOT NULL,
    result jsonb,
    error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    progress jsonb,
    cleanup_pending boolean DEFAULT false NOT NULL
);



CREATE TABLE public.video_cost_entries (
    id character varying(32) NOT NULL,
    production_id character varying(32) NOT NULL,
    idempotency_key character varying(120) NOT NULL,
    kind character varying(24) NOT NULL,
    amount_micros bigint NOT NULL,
    currency character varying(3) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);



CREATE TABLE public.video_production_artifacts (
    id character varying(32) NOT NULL,
    production_id character varying(32) NOT NULL,
    artifact_type character varying(40) NOT NULL,
    version integer NOT NULL,
    input_sha256 character varying(64) NOT NULL,
    payload jsonb NOT NULL,
    provenance jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);



CREATE TABLE public.video_production_decisions (
    id character varying(32) NOT NULL,
    production_id character varying(32) NOT NULL,
    action_id character varying(80) NOT NULL,
    action character varying(40) NOT NULL,
    expected_version integer NOT NULL,
    actor_id character varying(32) NOT NULL,
    reason text,
    status character varying(24) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    delivered_at timestamp with time zone
);



CREATE TABLE public.video_production_events (
    id integer NOT NULL,
    production_id character varying(32) NOT NULL,
    sequence integer NOT NULL,
    kind character varying(64) NOT NULL,
    stage character varying(48) NOT NULL,
    actor_id character varying(32),
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);



CREATE SEQUENCE public.video_production_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.video_production_events_id_seq OWNED BY public.video_production_events.id;



CREATE TABLE public.video_productions (
    id character varying(32) NOT NULL,
    task_id character varying(32) NOT NULL,
    workspace_id character varying(32) NOT NULL,
    user_id character varying(32) NOT NULL,
    session_id character varying(32),
    status character varying(32) NOT NULL,
    stage character varying(48) NOT NULL,
    version integer NOT NULL,
    projection jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    tenant_id character varying(26) DEFAULT 'system-tenant'::character varying NOT NULL
);



ALTER TABLE ONLY public.video_production_events ALTER COLUMN id SET DEFAULT nextval('public.video_production_events_id_seq'::regclass);



ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT ux_tasks_owner UNIQUE (owner_service, owner_ref);



ALTER TABLE ONLY public.video_cost_entries
    ADD CONSTRAINT ux_video_cost_entry_idempotency UNIQUE (production_id, idempotency_key);



ALTER TABLE ONLY public.video_production_artifacts
    ADD CONSTRAINT ux_video_production_artifact_version UNIQUE (production_id, artifact_type, version);



ALTER TABLE ONLY public.video_production_decisions
    ADD CONSTRAINT ux_video_production_decision_action UNIQUE (production_id, action_id);



ALTER TABLE ONLY public.video_production_events
    ADD CONSTRAINT ux_video_production_event_sequence UNIQUE (production_id, sequence);



ALTER TABLE ONLY public.video_cost_entries
    ADD CONSTRAINT video_cost_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.video_production_artifacts
    ADD CONSTRAINT video_production_artifacts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.video_production_decisions
    ADD CONSTRAINT video_production_decisions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.video_production_events
    ADD CONSTRAINT video_production_events_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.video_productions
    ADD CONSTRAINT video_productions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.video_productions
    ADD CONSTRAINT video_productions_task_id_key UNIQUE (task_id);



CREATE INDEX ix_tasks_pending_cleanup ON public.tasks USING btree (cleanup_pending) WHERE (cleanup_pending = true);



CREATE INDEX ix_tasks_workflow_run_id ON public.tasks USING btree (workflow_run_id);



CREATE INDEX ix_video_cost_entries_production_id ON public.video_cost_entries USING btree (production_id);



CREATE INDEX ix_video_production_artifacts_production_id ON public.video_production_artifacts USING btree (production_id);



CREATE INDEX ix_video_production_decisions_production_id ON public.video_production_decisions USING btree (production_id);



CREATE INDEX ix_video_production_events_production_id ON public.video_production_events USING btree (production_id);



CREATE INDEX ix_video_productions_session_id ON public.video_productions USING btree (session_id);



ALTER TABLE ONLY public.video_cost_entries
    ADD CONSTRAINT video_cost_entries_production_id_fkey FOREIGN KEY (production_id) REFERENCES public.video_productions(id);



ALTER TABLE ONLY public.video_production_artifacts
    ADD CONSTRAINT video_production_artifacts_production_id_fkey FOREIGN KEY (production_id) REFERENCES public.video_productions(id);



ALTER TABLE ONLY public.video_production_decisions
    ADD CONSTRAINT video_production_decisions_production_id_fkey FOREIGN KEY (production_id) REFERENCES public.video_productions(id);



ALTER TABLE ONLY public.video_production_events
    ADD CONSTRAINT video_production_events_production_id_fkey FOREIGN KEY (production_id) REFERENCES public.video_productions(id);



ALTER TABLE ONLY public.video_productions
    ADD CONSTRAINT video_productions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id);


