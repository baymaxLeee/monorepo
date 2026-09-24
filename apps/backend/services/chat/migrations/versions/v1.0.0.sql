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
    conversation_id character varying(32) NOT NULL,
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



CREATE TABLE public.conversation_artifact_cleanup_outbox (
    conversation_id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) DEFAULT 'system-tenant'::character varying NOT NULL
);



CREATE TABLE public.conversation_contexts (
    conversation_id character varying(32) NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    covered_through_message_id character varying(32),
    summary text NOT NULL,
    state_json jsonb NOT NULL,
    estimated_tokens integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.conversation_run_leases (
    conversation_id character varying(32) NOT NULL,
    run_id character varying(32) NOT NULL,
    heartbeat_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL
);



CREATE TABLE public.conversations (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    title character varying(200) DEFAULT '新对话'::character varying NOT NULL,
    model character varying(120) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    provider_id character varying(32) DEFAULT ''::character varying NOT NULL,
    workspace_id character varying(26) NOT NULL,
    active_plan_path character varying(512),
    canvas_id character varying(36),
    tenant_id character varying(26) DEFAULT 'system-tenant'::character varying NOT NULL,
    project_id character varying(36)
);



CREATE TABLE public.messages (
    id character varying(32) NOT NULL,
    conversation_id character varying(32) NOT NULL,
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
    supersedes_id character varying(32),
    embedding public.vector(2048)
);



ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT agent_steps_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.agent_tool_calls
    ADD CONSTRAINT agent_tool_calls_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.conversation_artifact_cleanup_outbox
    ADD CONSTRAINT conversation_artifact_cleanup_outbox_pkey PRIMARY KEY (conversation_id);



ALTER TABLE ONLY public.conversation_contexts
    ADD CONSTRAINT conversation_contexts_pkey PRIMARY KEY (conversation_id);



ALTER TABLE ONLY public.conversation_run_leases
    ADD CONSTRAINT conversation_run_leases_pkey PRIMARY KEY (conversation_id);



ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.user_memories
    ADD CONSTRAINT user_memories_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.conversation_run_leases
    ADD CONSTRAINT ux_conversation_run_leases_run_id UNIQUE (run_id);



CREATE INDEX ix_agent_runs_conversation_id ON public.agent_runs USING btree (conversation_id);



CREATE INDEX ix_agent_runs_user_id ON public.agent_runs USING btree (user_id);



CREATE INDEX ix_agent_steps_run_id ON public.agent_steps USING btree (run_id);



CREATE INDEX ix_agent_steps_run_step ON public.agent_steps USING btree (run_id, step_index);



CREATE INDEX ix_agent_tool_calls_run_id ON public.agent_tool_calls USING btree (run_id);



CREATE INDEX ix_agent_tool_calls_tool_name ON public.agent_tool_calls USING btree (tool_name);



CREATE INDEX ix_conversation_artifact_cleanup_outbox_available ON public.conversation_artifact_cleanup_outbox USING btree (available_at, created_at);



CREATE INDEX ix_conversations_canvas ON public.conversations USING btree (workspace_id, user_id, canvas_id);



CREATE INDEX ix_conversations_user_id ON public.conversations USING btree (user_id);



CREATE INDEX ix_conversations_user_org ON public.conversations USING btree (user_id, workspace_id);



CREATE INDEX ix_messages_conversation_id ON public.messages USING btree (conversation_id);



CREATE INDEX ix_user_memories_content_trgm ON public.user_memories USING gin (content public.gin_trgm_ops);



CREATE INDEX ix_user_memories_embedding_hnsw ON public.user_memories USING hnsw (((embedding)::public.halfvec(2048)) public.halfvec_cosine_ops) WITH (m='16', ef_construction='64');



CREATE INDEX ix_user_memories_user_id ON public.user_memories USING btree (user_id);



CREATE INDEX ix_user_memories_user_status ON public.user_memories USING btree (user_id, status);



CREATE UNIQUE INDEX ux_conversations_canvas_owner ON public.conversations USING btree (tenant_id, workspace_id, user_id, project_id, canvas_id);



ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT fk_agent_runs_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT fk_agent_steps_run_id FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.agent_tool_calls
    ADD CONSTRAINT fk_agent_tool_calls_run_id FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.conversation_contexts
    ADD CONSTRAINT fk_conversation_contexts_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.conversation_run_leases
    ADD CONSTRAINT fk_conversation_run_leases_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.conversation_run_leases
    ADD CONSTRAINT fk_conversation_run_leases_run_id FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
