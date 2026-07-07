-- v2.4.0: drop conversations.agent_mode. Agent mode (normal/plan) is a purely
-- ephemeral per-run input carried in the run request body (ADR-0035), not
-- conversation state — there is no longer a persisted column or PATCH endpoint
-- for it. active_plan_document_id stays: it IS conversation state (which plan
-- doc plan-mode context injection uses), written by write_plan/update_plan.

ALTER TABLE conversations
  DROP COLUMN IF EXISTS agent_mode;

UPDATE migration SET version = 'v2.4.0', update_time = NOW() WHERE id = 1;
