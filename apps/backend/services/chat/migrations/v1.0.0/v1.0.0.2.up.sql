-- Native UIMessage journal branches and idempotent run operations.
-- Existing linear histories are backfilled into a single selected path.

ALTER TABLE public.conversations
    ADD COLUMN history_revision bigint NOT NULL DEFAULT 0,
    ADD COLUMN selected_message_id character varying(32);

ALTER TABLE public.messages
    ADD COLUMN parent_message_id character varying(32),
    ADD COLUMN branch_index integer NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT id,
           lag(id) OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS parent_message_id
    FROM public.messages
)
UPDATE public.messages AS message
SET parent_message_id = ordered.parent_message_id
FROM ordered
WHERE ordered.id = message.id;

WITH leaves AS (
    SELECT DISTINCT ON (conversation_id) conversation_id, id
    FROM public.messages
    ORDER BY conversation_id, created_at DESC, id DESC
)
UPDATE public.conversations AS conversation
SET selected_message_id = leaves.id
FROM leaves
WHERE leaves.conversation_id = conversation.id;

ALTER TABLE public.messages
    ADD CONSTRAINT messages_parent_message_id_fkey
    FOREIGN KEY (parent_message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX ux_messages_sibling_branch
    ON public.messages (conversation_id, COALESCE(parent_message_id, ''), branch_index);
CREATE INDEX ix_messages_parent_message_id ON public.messages(parent_message_id);

ALTER TABLE public.agent_runs
    ADD COLUMN request_id character varying(64),
    ADD COLUMN operation character varying(32),
    ADD COLUMN target_message_id character varying(32),
    ADD COLUMN history_message_id character varying(32),
    ADD COLUMN history_revision bigint;

CREATE UNIQUE INDEX ux_agent_runs_conversation_request
    ON public.agent_runs(conversation_id, request_id)
    WHERE request_id IS NOT NULL;
CREATE INDEX ix_agent_runs_history_message_id ON public.agent_runs(history_message_id);

ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_operation_check
    CHECK (operation IS NULL OR operation IN ('submit-message', 'edit-message', 'regenerate-message', 'tool-continuation'));
