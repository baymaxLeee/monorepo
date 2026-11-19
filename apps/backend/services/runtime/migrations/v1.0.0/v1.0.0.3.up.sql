ALTER TABLE public.agent_steering_inputs
    DROP CONSTRAINT agent_steering_inputs_delivery_check;

ALTER TABLE public.agent_steering_inputs
    RENAME TO agent_run_inputs;

ALTER TABLE public.agent_run_inputs
    RENAME COLUMN delivery TO mode;

UPDATE public.agent_run_inputs
SET mode = CASE mode
    WHEN 'steer' THEN 'follow-up'
    WHEN 'queue' THEN 'next-turn'
    ELSE mode
END;

ALTER TABLE public.agent_run_inputs
    ADD CONSTRAINT agent_run_inputs_mode_check
    CHECK (mode IN ('follow-up', 'next-turn'));

ALTER INDEX public.ix_agent_steering_inputs_pending
    RENAME TO ix_agent_run_inputs_pending;
