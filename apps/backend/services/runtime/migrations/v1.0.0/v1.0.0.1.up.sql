-- Preserve sandbox terminal outcomes and normalize workspace/artifact provenance.

ALTER TABLE public.turn_sandbox_executions
    ADD COLUMN terminal_outcome varchar(32),
    ADD COLUMN finalization_summary jsonb,
    ADD COLUMN finalized_at timestamptz,
    ADD COLUMN released_at timestamptz;

ALTER TABLE public.turn_sandbox_executions
    DROP CONSTRAINT turn_sandbox_executions_state_check,
    DROP CONSTRAINT turn_sandbox_executions_resource_check;

ALTER TABLE public.turn_sandbox_executions
    ADD CONSTRAINT turn_sandbox_executions_state_check CHECK (
        state IN ('restoring', 'active', 'finalizing', 'releasing', 'released')
    ),
    ADD CONSTRAINT turn_sandbox_executions_resource_check CHECK (
        (state = 'restoring' AND sandbox_id IS NULL AND expires_at IS NULL)
        OR state IN ('active', 'finalizing', 'releasing', 'released')
    ),
    ADD CONSTRAINT turn_sandbox_executions_terminal_outcome_check CHECK (
        terminal_outcome IS NULL
        OR terminal_outcome IN ('released', 'resource_missing', 'superseded')
    ),
    ADD CONSTRAINT turn_sandbox_executions_terminal_state_check CHECK (
        (state = 'released' AND terminal_outcome IS NOT NULL AND released_at IS NOT NULL)
        OR (state <> 'released' AND terminal_outcome IS NULL AND released_at IS NULL)
    ),
    ADD CONSTRAINT turn_sandbox_executions_finalization_summary_check CHECK (
        finalization_summary IS NULL OR jsonb_typeof(finalization_summary) = 'object'
    );

CREATE TABLE public.workspace_effects (
    id varchar(64) NOT NULL,
    thread_id varchar(32) NOT NULL,
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    producer varchar(32) NOT NULL,
    tool_call_id varchar(128),
    operation varchar(12) NOT NULL,
    file_id varchar(32) NOT NULL,
    workspace_path varchar(1024) NOT NULL,
    base_revision_id uuid,
    result_revision_id uuid,
    base_path_generation bigint,
    result_path_generation bigint,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (turn_id, id),
    CONSTRAINT fk_workspace_effects_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.thread_turns(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_workspace_effects_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE,
    CONSTRAINT fk_workspace_effects_file
        FOREIGN KEY (thread_id, file_id)
        REFERENCES public.thread_files(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT workspace_effects_producer_check CHECK (
        producer IN ('artifact-tool', 'workspace-finalizer')
    ),
    CONSTRAINT workspace_effects_operation_check CHECK (
        operation IN ('create', 'update', 'delete')
    ),
    CONSTRAINT workspace_effects_revision_shape_check CHECK (
        (operation = 'create' AND base_revision_id IS NULL AND result_revision_id IS NOT NULL)
        OR (operation = 'update' AND base_revision_id IS NOT NULL AND result_revision_id IS NOT NULL)
        OR (operation = 'delete' AND base_revision_id IS NOT NULL AND result_revision_id IS NULL)
    ),
    CONSTRAINT workspace_effects_generation_shape_check CHECK (
        (operation = 'create' AND base_path_generation IS NULL AND result_path_generation > 0)
        OR (
            operation = 'update'
            AND base_path_generation > 0
            AND result_path_generation = base_path_generation
        )
        OR (
            operation = 'delete'
            AND base_path_generation > 0
            AND result_path_generation = base_path_generation + 1
        )
    )
);

CREATE INDEX ix_workspace_effects_attempt
    ON public.workspace_effects (turn_id, attempt_epoch, created_at);
CREATE INDEX ix_workspace_effects_file
    ON public.workspace_effects (thread_id, file_id, created_at);

CREATE TABLE public.artifact_occurrences (
    id varchar(32) PRIMARY KEY,
    thread_id varchar(32) NOT NULL,
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL CHECK (attempt_epoch > 0),
    tool_call_id varchar(128) NOT NULL,
    artifact_index integer NOT NULL CHECK (artifact_index >= 0),
    workspace_effect_id varchar(64),
    file_id varchar(32) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    sha256 varchar(64) NOT NULL,
    workspace_path varchar(1024) NOT NULL,
    output_role varchar(20) NOT NULL DEFAULT 'deliverable',
    created_at timestamptz NOT NULL,
    CONSTRAINT ux_artifact_occurrences_publication
        UNIQUE (turn_id, attempt_epoch, tool_call_id, artifact_index),
    CONSTRAINT fk_artifact_occurrences_turn
        FOREIGN KEY (thread_id, turn_id)
        REFERENCES public.thread_turns(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_artifact_occurrences_attempt
        FOREIGN KEY (turn_id, attempt_epoch)
        REFERENCES public.turn_attempts(turn_id, attempt_epoch) ON DELETE CASCADE,
    CONSTRAINT fk_artifact_occurrences_file
        FOREIGN KEY (thread_id, file_id)
        REFERENCES public.thread_files(thread_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_artifact_occurrences_workspace_effect
        FOREIGN KEY (turn_id, workspace_effect_id)
        REFERENCES public.workspace_effects(turn_id, id),
    CONSTRAINT artifact_occurrences_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT artifact_occurrences_output_role_check CHECK (output_role = 'deliverable')
);

CREATE INDEX ix_artifact_occurrences_file_revision
    ON public.artifact_occurrences (thread_id, file_id, revision_id);
CREATE INDEX ix_artifact_occurrences_attempt
    ON public.artifact_occurrences (turn_id, attempt_epoch, artifact_index);
