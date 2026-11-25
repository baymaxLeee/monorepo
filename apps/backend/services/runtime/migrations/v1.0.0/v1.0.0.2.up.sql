-- Add reusable workspace generations and tighten the final lifecycle ledger.

ALTER TABLE public.threads
    ADD COLUMN sandbox_generation bigint NOT NULL DEFAULT 0
    CHECK (sandbox_generation >= 0);

ALTER TABLE public.turn_sandbox_executions
    ADD COLUMN workspace_generation bigint;

UPDATE public.turn_sandbox_executions
SET workspace_generation = 1;

UPDATE public.threads AS thread
SET sandbox_generation = 1
WHERE EXISTS (
    SELECT 1
    FROM public.turn_sandbox_executions AS execution
    WHERE execution.thread_id = thread.id
);

ALTER TABLE public.turn_sandbox_executions
    ALTER COLUMN workspace_generation SET NOT NULL,
    ADD CONSTRAINT turn_sandbox_executions_workspace_generation_check
        CHECK (workspace_generation > 0),
    DROP CONSTRAINT turn_sandbox_executions_terminal_outcome_check;

UPDATE public.turn_sandbox_executions
SET terminal_outcome = 'destroyed'
WHERE terminal_outcome = 'released';

ALTER TABLE public.turn_sandbox_executions
    ADD CONSTRAINT turn_sandbox_executions_terminal_outcome_check CHECK (
        terminal_outcome IS NULL
        OR terminal_outcome IN ('retained', 'destroyed', 'resource_missing', 'superseded')
    );

ALTER TABLE public.artifact_occurrences
    ALTER COLUMN workspace_effect_id SET NOT NULL,
    DROP CONSTRAINT artifact_occurrences_output_role_check,
    DROP COLUMN output_role;
