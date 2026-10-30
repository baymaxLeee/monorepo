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
    conversation_id character varying(32),
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



CREATE INDEX ix_video_productions_conversation_id ON public.video_productions USING btree (conversation_id);



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
