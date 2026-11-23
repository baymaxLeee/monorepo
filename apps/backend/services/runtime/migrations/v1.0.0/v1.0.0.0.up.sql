-- Runtime v1.0.0 fresh-install baseline.
--
-- This release intentionally resets the pre-1.0 Session/Run/Message schema.
-- PostgreSQL is the authoritative Thread/Turn/Item journal; provider cursors,
-- step traces and tool rows are projections that may be rebuilt from it.
-- The migration runner owns the migration metadata tables and transaction.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE TABLE public.threads (
    id varchar(32) PRIMARY KEY,
    user_id varchar(26) NOT NULL,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    model varchar(120) NOT NULL DEFAULT '',
    provider_id varchar(32) NOT NULL DEFAULT '',
    reasoning_effort varchar(16) NOT NULL DEFAULT 'medium',
    approval_policy varchar(24) NOT NULL DEFAULT 'on-request',
    permission_profile varchar(32) NOT NULL DEFAULT ':workspace',
    execution_mode varchar(20) NOT NULL DEFAULT 'cloud',
    turn_sequence bigint NOT NULL DEFAULT 0 CHECK (turn_sequence >= 0),
    item_sequence bigint NOT NULL DEFAULT 0 CHECK (item_sequence >= 0),
    history_revision bigint NOT NULL DEFAULT 0 CHECK (history_revision >= 0),
    selected_item_id varchar(32),
    create_request_id varchar(64) NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT threads_execution_mode_check CHECK (execution_mode IN ('local', 'cloud'))
);

CREATE UNIQUE INDEX ux_threads_create_request
    ON public.threads (tenant_id, workspace_id, user_id, create_request_id);
CREATE INDEX ix_threads_user_id ON public.threads (user_id);
CREATE INDEX ix_threads_scope_updated
    ON public.threads (tenant_id, workspace_id, user_id, updated_at);

CREATE TABLE public.turns (
    id varchar(32) PRIMARY KEY,
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    ordinal bigint NOT NULL CHECK (ordinal > 0),
    user_id varchar(26) NOT NULL,
    provider_id varchar(32) NOT NULL DEFAULT '',
    model varchar(120) NOT NULL DEFAULT '',
    status varchar(20) NOT NULL,
    error text,
    input_item_id varchar(32),
    output_item_id varchar(32),
    input_tokens integer,
    output_tokens integer,
    cached_input_tokens integer,
    reasoning_tokens integer,
    total_tokens integer,
    created_at timestamptz NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    CONSTRAINT turns_status_check CHECK (
        status IN ('running', 'cancel_requested', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')
    ),
    CONSTRAINT turns_token_usage_check CHECK (
        (input_tokens IS NULL OR input_tokens >= 0)
        AND (output_tokens IS NULL OR output_tokens >= 0)
        AND (cached_input_tokens IS NULL OR cached_input_tokens >= 0)
        AND (reasoning_tokens IS NULL OR reasoning_tokens >= 0)
        AND (total_tokens IS NULL OR total_tokens >= 0)
    ),
    CONSTRAINT ux_turns_thread_id UNIQUE (thread_id, id),
    CONSTRAINT ux_turns_thread_ordinal UNIQUE (thread_id, ordinal)
);

CREATE UNIQUE INDEX ux_turns_one_active
    ON public.turns (thread_id)
    WHERE status IN ('running', 'cancel_requested', 'waiting');
CREATE INDEX ix_turns_thread_created ON public.turns (thread_id, created_at);
CREATE INDEX ix_turns_user_id ON public.turns (user_id);

CREATE TABLE public.turn_plugin_snapshots (
    turn_id varchar(32) PRIMARY KEY REFERENCES public.turns(id) ON DELETE CASCADE,
    snapshot_json jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT turn_plugin_snapshots_object_check CHECK (jsonb_typeof(snapshot_json) = 'object'),
    CONSTRAINT turn_plugin_snapshots_schema_check CHECK (snapshot_json ->> 'schemaVersion' = '1')
);

CREATE TABLE public.thread_items (
    id varchar(32) PRIMARY KEY,
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    turn_id varchar(32),
    ordinal bigint NOT NULL CHECK (ordinal > 0),
    role varchar(20) NOT NULL,
    content jsonb NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ok',
    parent_item_id varchar(32),
    branch_index integer NOT NULL DEFAULT 0 CHECK (branch_index >= 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT ux_thread_items_thread_id UNIQUE (thread_id, id),
    CONSTRAINT ux_thread_items_ordinal UNIQUE (thread_id, ordinal),
    CONSTRAINT fk_thread_items_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.turns(thread_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_thread_items_parent
        FOREIGN KEY (thread_id, parent_item_id)
        REFERENCES public.thread_items(thread_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_thread_items_parent ON public.thread_items (parent_item_id);
CREATE INDEX ix_thread_items_turn_ordinal ON public.thread_items (turn_id, ordinal);
CREATE UNIQUE INDEX ux_thread_items_sibling_branch
    ON public.thread_items (thread_id, COALESCE(parent_item_id, ''), branch_index);

ALTER TABLE public.threads
    ADD CONSTRAINT fk_threads_selected_item
    FOREIGN KEY (id, selected_item_id)
    REFERENCES public.thread_items(thread_id, id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.turns
    ADD CONSTRAINT fk_turns_input_item
        FOREIGN KEY (thread_id, input_item_id)
        REFERENCES public.thread_items(thread_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT fk_turns_output_item
        FOREIGN KEY (thread_id, output_item_id)
        REFERENCES public.thread_items(thread_id, id)
        DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.turn_attempts (
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    request_id varchar(64),
    request_fingerprint varchar(64),
    operation varchar(32) NOT NULL,
    target_item_id varchar(32),
    history_item_id varchar(32),
    history_revision bigint,
    status varchar(20) NOT NULL,
    error text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    PRIMARY KEY (turn_id, attempt_epoch),
    CONSTRAINT fk_turn_attempts_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.turns(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_turn_attempts_target_item
        FOREIGN KEY (thread_id, target_item_id)
        REFERENCES public.thread_items(thread_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_turn_attempts_history_item
        FOREIGN KEY (thread_id, history_item_id)
        REFERENCES public.thread_items(thread_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT turn_attempts_status_check CHECK (
        status IN ('running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')
    ),
    CONSTRAINT turn_attempts_operation_check CHECK (
        operation IN (
            'submit-message', 'edit-message', 'regenerate-message', 'tool-continuation',
            'internal', 'recovery'
        )
    ),
    CONSTRAINT turn_attempts_request_binding_check CHECK (
        (request_id IS NULL AND request_fingerprint IS NULL AND operation IN ('internal', 'recovery'))
        OR (request_id IS NOT NULL AND request_fingerprint IS NOT NULL
            AND operation NOT IN ('internal', 'recovery'))
    )
);

CREATE UNIQUE INDEX ux_turn_attempts_thread_request
    ON public.turn_attempts (thread_id, request_id);
CREATE INDEX ix_turn_attempts_turn_started
    ON public.turn_attempts (turn_id, started_at);
CREATE INDEX ix_turn_attempts_history_item
    ON public.turn_attempts (history_item_id);

CREATE TABLE public.turn_resume_envelopes (
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    history_item_id varchar(32) NOT NULL,
    history_revision bigint NOT NULL CHECK (history_revision > 0),
    history_digest varchar(64) NOT NULL CHECK (history_digest ~ '^[a-f0-9]{64}$'),
    instruction_digest varchar(64) NOT NULL CHECK (instruction_digest ~ '^[a-f0-9]{64}$'),
    tool_catalog_digest varchar(64) NOT NULL CHECK (tool_catalog_digest ~ '^[a-f0-9]{64}$'),
    workspace_digest varchar(64) NOT NULL CHECK (workspace_digest ~ '^[a-f0-9]{64}$'),
    compactor_version varchar(64) NOT NULL,
    remote_binding text,
    snapshot_json jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (turn_id, attempt_epoch),
    CONSTRAINT fk_turn_resume_envelopes_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE,
    CONSTRAINT fk_turn_resume_envelopes_history_item
        FOREIGN KEY (thread_id, history_item_id)
        REFERENCES public.thread_items(thread_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT turn_resume_envelopes_snapshot_check CHECK (
        jsonb_typeof(snapshot_json) = 'object'
        AND snapshot_json ->> 'schemaVersion' = '1'
    )
);

CREATE INDEX ix_turn_resume_envelopes_thread
    ON public.turn_resume_envelopes (thread_id, created_at);

CREATE TABLE public.turn_inputs (
    turn_id varchar(32) NOT NULL,
    id varchar(64) NOT NULL,
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    mode varchar(20) NOT NULL,
    text text NOT NULL,
    state varchar(20) NOT NULL,
    step_number integer,
    reason text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (turn_id, id),
    CONSTRAINT fk_turn_inputs_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.turns(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT turn_inputs_mode_check CHECK (mode IN ('follow-up', 'next-turn')),
    CONSTRAINT turn_inputs_state_check CHECK (
        state IN ('accepted', 'dispatching', 'delivered', 'not_delivered', 'unconfirmed')
    ),
    CONSTRAINT turn_inputs_step_check CHECK (step_number IS NULL OR step_number >= 0)
);

CREATE INDEX ix_turn_inputs_pending ON public.turn_inputs (turn_id, state, created_at);

CREATE TABLE public.context_checkpoints (
    thread_id varchar(32) PRIMARY KEY REFERENCES public.threads(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    covered_item_id varchar(32) NOT NULL,
    summary text NOT NULL,
    state_json jsonb NOT NULL,
    source_history_revision bigint NOT NULL CHECK (source_history_revision > 0),
    source_history_digest varchar(64) NOT NULL CHECK (source_history_digest ~ '^[a-f0-9]{64}$'),
    instruction_digest varchar(64) NOT NULL CHECK (instruction_digest ~ '^[a-f0-9]{64}$'),
    tool_catalog_digest varchar(64) NOT NULL CHECK (tool_catalog_digest ~ '^[a-f0-9]{64}$'),
    workspace_digest varchar(64) NOT NULL CHECK (workspace_digest ~ '^[a-f0-9]{64}$'),
    compactor_version varchar(64) NOT NULL,
    remote_binding text,
    estimated_tokens integer NOT NULL DEFAULT 0 CHECK (estimated_tokens >= 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT fk_context_checkpoints_item
        FOREIGN KEY (thread_id, covered_item_id)
        REFERENCES public.thread_items(thread_id, id) ON DELETE CASCADE
);

CREATE TABLE public.turn_leases (
    thread_id varchar(32) PRIMARY KEY REFERENCES public.threads(id) ON DELETE CASCADE,
    turn_id varchar(32) NOT NULL UNIQUE,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    heartbeat_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CONSTRAINT fk_turn_leases_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.turns(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_turn_leases_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE
);

CREATE TABLE public.turn_steps (
    id varchar(32) PRIMARY KEY,
    turn_id varchar(32) NOT NULL REFERENCES public.turns(id) ON DELETE CASCADE,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    step_index integer NOT NULL CHECK (step_index >= 0),
    kind varchar(32) NOT NULL,
    status varchar(20) NOT NULL,
    summary text,
    metadata jsonb,
    input_tokens integer,
    output_tokens integer,
    total_tokens integer,
    created_at timestamptz NOT NULL,
    completed_at timestamptz,
    CONSTRAINT ux_turn_steps_turn_attempt_step UNIQUE (turn_id, attempt_epoch, step_index),
    CONSTRAINT fk_turn_steps_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE,
    CONSTRAINT turn_steps_token_usage_check CHECK (
        (input_tokens IS NULL OR input_tokens >= 0)
        AND (output_tokens IS NULL OR output_tokens >= 0)
        AND (total_tokens IS NULL OR total_tokens >= 0)
    )
);

CREATE INDEX ix_turn_steps_turn_id ON public.turn_steps (turn_id);

CREATE TABLE public.tool_effects (
    id varchar(64) NOT NULL,
    turn_id varchar(32) NOT NULL REFERENCES public.turns(id) ON DELETE CASCADE,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    item_id varchar(32),
    step_index integer,
    tool_name varchar(80) NOT NULL,
    status varchar(20) NOT NULL,
    input_digest varchar(64) NOT NULL,
    input_json jsonb,
    output_json jsonb,
    error text,
    duration_ms integer,
    created_at timestamptz NOT NULL,
    completed_at timestamptz,
    PRIMARY KEY (turn_id, id),
    CONSTRAINT fk_tool_effects_item
        FOREIGN KEY (item_id)
        REFERENCES public.thread_items(id) ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_tool_effects_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE,
    CONSTRAINT tool_effects_step_check CHECK (step_index IS NULL OR step_index >= 0),
    CONSTRAINT tool_effects_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX ix_tool_effects_turn_id ON public.tool_effects (turn_id);
CREATE INDEX ix_tool_effects_tool_name ON public.tool_effects (tool_name);

CREATE TABLE public.turn_sandbox_executions (
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    user_id varchar(26) NOT NULL,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    state varchar(20) NOT NULL,
    sandbox_id varchar(128),
    expires_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (turn_id, attempt_epoch),
    CONSTRAINT fk_turn_sandbox_executions_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.turns(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_turn_sandbox_executions_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE,
    CONSTRAINT turn_sandbox_executions_state_check CHECK (
        state IN ('restoring', 'active', 'finalizing', 'releasing')
    ),
    CONSTRAINT turn_sandbox_executions_resource_check CHECK (
        (state = 'restoring' AND sandbox_id IS NULL AND expires_at IS NULL)
        OR state IN ('active', 'finalizing', 'releasing')
    )
);

CREATE INDEX ix_turn_sandbox_executions_releasing
    ON public.turn_sandbox_executions (state, updated_at);

CREATE TABLE public.sandbox_workspace_checkout (
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL,
    workspace_path text NOT NULL,
    file_id varchar(32) NOT NULL,
    path_generation bigint NOT NULL,
    etag text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    PRIMARY KEY (turn_id, attempt_epoch, workspace_path),
    FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_sandbox_executions (turn_id, attempt_epoch) ON DELETE CASCADE
);

CREATE TABLE public.thread_files (
    id varchar(32) PRIMARY KEY,
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    user_id varchar(26) NOT NULL,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    title varchar(255) NOT NULL,
    filename varchar(255) NOT NULL,
    workspace_path varchar(1024) NOT NULL,
    workspace_state varchar(20) NOT NULL DEFAULT 'live',
    path_generation bigint NOT NULL DEFAULT 1 CHECK (path_generation > 0),
    media_type varchar(255) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    sha256 varchar(64) NOT NULL,
    idempotency_key varchar(255) NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    content_generation bigint NOT NULL DEFAULT 1 CHECK (content_generation > 0),
    content_etag varchar(32) NOT NULL,
    last_writer_type varchar(20) NOT NULL,
    last_writer_id varchar(128),
    CONSTRAINT ux_thread_files_thread_id UNIQUE (thread_id, id),
    CONSTRAINT thread_files_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT thread_files_workspace_state_check CHECK (workspace_state IN ('live', 'deleted')),
    CONSTRAINT thread_files_last_writer_type_check CHECK (last_writer_type IN ('unknown', 'user', 'agent')),
    CONSTRAINT thread_files_workspace_path_check CHECK (
        workspace_path LIKE '/workspace/%'
        AND workspace_path !~ E'[\\x00-\\x1f]'
        AND workspace_path !~ '(^|/)\\.{1,2}(/|$)'
    ),
    CONSTRAINT ux_thread_files_idempotency
        UNIQUE (tenant_id, workspace_id, user_id, thread_id, idempotency_key)
);

CREATE INDEX ix_thread_files_thread ON public.thread_files (thread_id, created_at);
CREATE INDEX ix_thread_files_asset_revision ON public.thread_files (asset_id, revision_id);
CREATE UNIQUE INDEX ux_thread_files_live_workspace_path
    ON public.thread_files (tenant_id, workspace_id, thread_id, workspace_path)
    WHERE workspace_state = 'live';

CREATE TABLE public.thread_file_save_operations (
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    user_id varchar(26) NOT NULL,
    thread_id varchar(32) NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    operation_id varchar(80) NOT NULL,
    file_id varchar(32) NOT NULL,
    expected_etag varchar(34) NOT NULL,
    content_sha256 varchar(64) NOT NULL,
    operation_type varchar(20) NOT NULL,
    workspace_path varchar(1024),
    expected_path_generation bigint,
    writer_type varchar(20) NOT NULL,
    writer_id varchar(128) NOT NULL,
    status varchar(20) NOT NULL,
    lease_until timestamptz,
    result_json jsonb,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, user_id, thread_id, operation_id),
    CONSTRAINT fk_thread_file_save_operations_file
        FOREIGN KEY (thread_id, file_id)
        REFERENCES public.thread_files(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT thread_file_save_operations_sha256_check CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT thread_file_save_operations_type_check CHECK (operation_type = 'update'),
    CONSTRAINT thread_file_save_operations_writer_check CHECK (writer_type IN ('user', 'agent')),
    CONSTRAINT thread_file_save_operations_status_check CHECK (status IN ('pending', 'succeeded', 'conflict')),
    CONSTRAINT thread_file_save_operations_generation_check CHECK (
        expected_path_generation IS NULL OR expected_path_generation > 0
    )
);

CREATE INDEX ix_thread_file_save_operations_file
    ON public.thread_file_save_operations (file_id, created_at);
CREATE INDEX ix_thread_file_save_operations_pending
    ON public.thread_file_save_operations (status, lease_until)
    WHERE status = 'pending';

CREATE TABLE public.asset_claim_intents (
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    owner_type varchar(64) NOT NULL,
    owner_id varchar(128) NOT NULL,
    slot varchar(128) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid,
    kind varchar(20) NOT NULL,
    generation bigint NOT NULL CHECK (generation > 0),
    desired_state varchar(20) NOT NULL,
    delivered_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL,
    lease_until timestamptz,
    state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
    last_error text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, owner_type, owner_id, slot),
    CONSTRAINT asset_claim_intents_kind_check CHECK (kind IN ('strong', 'snapshot', 'lease', 'weak')),
    CONSTRAINT asset_claim_intents_state_check CHECK (desired_state IN ('active', 'released'))
);

CREATE INDEX ix_asset_claim_intents_due
    ON public.asset_claim_intents (delivered_at, next_attempt_at, lease_until);

CREATE TABLE public.thread_artifact_cleanup_outbox (
    thread_id varchar(32) PRIMARY KEY,
    user_id varchar(26) NOT NULL,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL,
    claimed_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL
);

CREATE INDEX ix_thread_artifact_cleanup_outbox_available
    ON public.thread_artifact_cleanup_outbox (available_at, created_at);

CREATE TABLE public.user_memories (
    id varchar(32) PRIMARY KEY,
    user_id varchar(26) NOT NULL,
    category varchar(40) NOT NULL,
    content text NOT NULL,
    source varchar(80) NOT NULL DEFAULT 'agent',
    confidence integer NOT NULL DEFAULT 80 CHECK (confidence BETWEEN 0 AND 100),
    status varchar(20) NOT NULL DEFAULT 'active',
    reason text,
    origin_turn_id varchar(32),
    supersedes_id varchar(32),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE INDEX ix_user_memories_user_id ON public.user_memories (user_id);
CREATE INDEX ix_user_memories_user_status ON public.user_memories (user_id, status);

-- Local inference records contain authorization/accounting metadata only.
-- No local Thread, prompt, tool result or file content is stored here.
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

CREATE INDEX ix_local_inference_active
    ON public.local_inference_requests (tenant_id, workspace_id, user_id, deadline)
    WHERE status = 'admitted';

-- Detached durable Jobs remain independent from interactive Turns.
CREATE TABLE public.tasks (
    id varchar(32) PRIMARY KEY,
    type varchar(64) NOT NULL,
    status varchar(20) NOT NULL,
    owner_service varchar(40) NOT NULL,
    owner_ref varchar(80) NOT NULL,
    workflow_run_id varchar(64),
    cleanup_pending boolean NOT NULL DEFAULT false,
    payload jsonb NOT NULL,
    result jsonb,
    progress jsonb,
    error text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    finished_at timestamptz,
    CONSTRAINT ux_tasks_owner UNIQUE (owner_service, owner_ref)
);

CREATE INDEX ix_tasks_workflow_run_id ON public.tasks (workflow_run_id);
CREATE INDEX ix_tasks_pending_cleanup ON public.tasks (cleanup_pending) WHERE cleanup_pending = true;

CREATE TABLE public.video_productions (
    id varchar(32) PRIMARY KEY,
    task_id varchar(32) NOT NULL UNIQUE REFERENCES public.tasks(id),
    tenant_id varchar(32) NOT NULL,
    workspace_id varchar(32) NOT NULL,
    user_id varchar(32) NOT NULL,
    thread_id varchar(32) REFERENCES public.threads(id) ON DELETE SET NULL,
    status varchar(32) NOT NULL,
    stage varchar(48) NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    projection jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    finished_at timestamptz
);

CREATE INDEX ix_video_productions_thread_id ON public.video_productions (thread_id);

CREATE TABLE public.video_production_artifacts (
    id varchar(32) PRIMARY KEY,
    production_id varchar(32) NOT NULL REFERENCES public.video_productions(id),
    artifact_type varchar(40) NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    input_sha256 varchar(64) NOT NULL,
    payload jsonb NOT NULL,
    provenance jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT ux_video_production_artifact_version
        UNIQUE (production_id, artifact_type, version)
);

CREATE INDEX ix_video_production_artifacts_production_id
    ON public.video_production_artifacts (production_id);

CREATE TABLE public.video_production_events (
    id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    production_id varchar(32) NOT NULL REFERENCES public.video_productions(id),
    sequence integer NOT NULL CHECK (sequence >= 0),
    kind varchar(64) NOT NULL,
    stage varchar(48) NOT NULL,
    actor_id varchar(32),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT ux_video_production_event_sequence UNIQUE (production_id, sequence)
);

CREATE INDEX ix_video_production_events_production_id
    ON public.video_production_events (production_id);

CREATE TABLE public.video_production_decisions (
    id varchar(32) PRIMARY KEY,
    production_id varchar(32) NOT NULL REFERENCES public.video_productions(id),
    action_id varchar(80) NOT NULL,
    action varchar(40) NOT NULL,
    expected_version integer NOT NULL,
    actor_id varchar(32) NOT NULL,
    reason text,
    status varchar(24) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    delivered_at timestamptz,
    CONSTRAINT ux_video_production_decision_action UNIQUE (production_id, action_id)
);

CREATE INDEX ix_video_production_decisions_production_id
    ON public.video_production_decisions (production_id);

CREATE TABLE public.video_cost_entries (
    id varchar(32) PRIMARY KEY,
    production_id varchar(32) NOT NULL REFERENCES public.video_productions(id),
    idempotency_key varchar(120) NOT NULL,
    kind varchar(24) NOT NULL,
    amount_micros bigint NOT NULL,
    currency varchar(3) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT ux_video_cost_entry_idempotency UNIQUE (production_id, idempotency_key)
);

CREATE INDEX ix_video_cost_entries_production_id
    ON public.video_cost_entries (production_id);
