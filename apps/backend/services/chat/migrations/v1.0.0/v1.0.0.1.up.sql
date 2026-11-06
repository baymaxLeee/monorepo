ALTER TABLE public.conversations
    ADD COLUMN run_revision bigint NOT NULL DEFAULT 0;

-- Every lease writer, including an older Chat instance during rollout, takes
-- the same conversation row lock and invalidates in-flight fork snapshots.
CREATE FUNCTION public.advance_conversation_run_revision() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.conversations
    SET run_revision = run_revision + 1
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_run_lease_revision
    BEFORE INSERT ON public.conversation_run_leases
    FOR EACH ROW EXECUTE FUNCTION public.advance_conversation_run_revision();
