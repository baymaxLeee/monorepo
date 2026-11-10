-- Virtual workspaces now live only in the per-run Sandbox filesystem. Release
-- any durable Storage claims owned by the retired Knowledge rows, then remove
-- the virtual tree and change-set schema.
UPDATE public.asset_claim_intents
SET desired_state = 'released',
    delivered_at = NULL,
    attempt_count = 0,
    next_attempt_at = NOW(),
    lease_until = NULL,
    state_version = state_version + 1,
    last_error = NULL,
    updated_at = NOW()
WHERE owner_type IN ('file_entry', 'file_change_set_entry')
  AND desired_state <> 'released';

DROP TABLE public.file_change_set_entries;
DROP TABLE public.file_change_sets;
DROP TABLE public.file_entries;

-- Idempotency is scoped to the owning principal and conversation. Reusing a
-- key in another scope creates an independent publication decision.
ALTER TABLE public.staged_media
    DROP CONSTRAINT staged_media_idempotency_key_key;

CREATE UNIQUE INDEX ux_staged_media_idempotency_scope
    ON public.staged_media (
        tenant_id,
        workspace_id,
        user_id,
        COALESCE(conversation_id, ''),
        idempotency_key
    )
    WHERE idempotency_key IS NOT NULL;
