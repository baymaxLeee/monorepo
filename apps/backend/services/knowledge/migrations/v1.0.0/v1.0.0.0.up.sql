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


CREATE TABLE public.asset_claim_intents (
    owner_type character varying(64) NOT NULL,
    owner_id character varying(128) NOT NULL,
    slot character varying(128) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid,
    kind character varying(20) NOT NULL,
    generation bigint NOT NULL,
    desired_state character varying(20) NOT NULL,
    delivered_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    state_version bigint DEFAULT 1 NOT NULL,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT asset_claim_intents_desired_state_check CHECK (((desired_state)::text = ANY (ARRAY[('active'::character varying)::text, ('released'::character varying)::text]))),
    CONSTRAINT asset_claim_intents_generation_check CHECK ((generation > 0)),
    CONSTRAINT asset_claim_intents_kind_check CHECK (((kind)::text = ANY (ARRAY[('strong'::character varying)::text, ('snapshot'::character varying)::text, ('lease'::character varying)::text, ('weak'::character varying)::text])))
);



CREATE TABLE public.conversation_artifact_tombstones (
    conversation_id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) NOT NULL
);



CREATE TABLE public.document_chunks (
    id character varying(32) NOT NULL,
    document_id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    contextualized_content text,
    embedding public.vector(2048),
    token_count integer DEFAULT 0 NOT NULL,
    embed_model character varying(120),
    created_at timestamp with time zone NOT NULL,
    workspace_id character varying(26),
    tenant_id character varying(26) NOT NULL
);



CREATE TABLE public.documents (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    conversation_id character varying(32),
    kind character varying(20) NOT NULL,
    title character varying(255) NOT NULL,
    filename character varying(255) NOT NULL,
    mime_type character varying(120) DEFAULT 'text/markdown'::character varying NOT NULL,
    content_md text NOT NULL,
    source_size integer DEFAULT 0 NOT NULL,
    source_mime_type character varying(120),
    source_filename character varying(255),
    ingest_status character varying(20) DEFAULT 'ready'::character varying NOT NULL,
    ingest_progress integer DEFAULT 100 NOT NULL,
    ingest_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workspace_id character varying(26),
    index_status character varying(20) DEFAULT 'skipped'::character varying NOT NULL,
    index_error text,
    tenant_id character varying(26) NOT NULL,
    conversion_provider_id character varying(32) DEFAULT NULL::character varying,
    processing_dispatched_at timestamp with time zone,
    asset_id uuid,
    source_revision_id uuid,
    source_sha256 character varying(64)
);



CREATE TABLE public.file_change_set_entries (
    id character varying(32) NOT NULL,
    change_set_id character varying(32) NOT NULL,
    path character varying(512) NOT NULL,
    mime_type character varying(120) NOT NULL,
    content text NOT NULL,
    sha256 character varying(64) NOT NULL,
    writable boolean DEFAULT true NOT NULL,
    derived boolean DEFAULT false NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.file_change_sets (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    conversation_id character varying(32) NOT NULL,
    status character varying(24) NOT NULL,
    baseline_sha256 jsonb NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) NOT NULL
);



CREATE TABLE public.file_entries (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    conversation_id character varying(32) NOT NULL,
    path character varying(512) NOT NULL,
    mime_type character varying(120) NOT NULL,
    content text NOT NULL,
    sha256 character varying(64) NOT NULL,
    writable boolean DEFAULT true NOT NULL,
    derived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) NOT NULL
);



CREATE TABLE public.staged_media (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    conversation_id character varying(32),
    title character varying(255) NOT NULL,
    filename character varying(255) NOT NULL,
    mime_type character varying(120) NOT NULL,
    size integer NOT NULL,
    idempotency_key character varying(128),
    status character varying(20) NOT NULL,
    document_id character varying(32),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    asset_sha256 character varying(64) NOT NULL,
    CONSTRAINT staged_media_status_check CHECK (((status)::text = ANY (ARRAY[('staged'::character varying)::text, ('published'::character varying)::text, ('discarded'::character varying)::text])))
);



ALTER TABLE ONLY public.asset_claim_intents
    ADD CONSTRAINT asset_claim_intents_pkey PRIMARY KEY (tenant_id, workspace_id, owner_type, owner_id, slot);



ALTER TABLE ONLY public.conversation_artifact_tombstones
    ADD CONSTRAINT conversation_artifact_tombstones_pkey PRIMARY KEY (conversation_id);



ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.file_change_set_entries
    ADD CONSTRAINT file_change_set_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.file_change_sets
    ADD CONSTRAINT file_change_sets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.file_entries
    ADD CONSTRAINT file_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.staged_media
    ADD CONSTRAINT staged_media_idempotency_key_key UNIQUE (idempotency_key);



ALTER TABLE ONLY public.staged_media
    ADD CONSTRAINT staged_media_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT ux_document_chunks_doc_index UNIQUE (document_id, chunk_index);



ALTER TABLE ONLY public.file_change_set_entries
    ADD CONSTRAINT ux_file_change_set_path UNIQUE (change_set_id, path);



ALTER TABLE ONLY public.file_entries
    ADD CONSTRAINT ux_file_entry_root_path UNIQUE (user_id, conversation_id, path);



CREATE INDEX ix_asset_claim_intents_delivery ON public.asset_claim_intents USING btree (next_attempt_at, lease_until, updated_at, owner_id) WHERE (delivered_at IS NULL);



CREATE INDEX ix_conversation_artifact_tombstones_user_id ON public.conversation_artifact_tombstones USING btree (user_id);



CREATE INDEX ix_document_chunks_content_trgm ON public.document_chunks USING gin (content public.gin_trgm_ops);



CREATE INDEX ix_document_chunks_document_id ON public.document_chunks USING btree (document_id);



CREATE INDEX ix_document_chunks_embedding_hnsw ON public.document_chunks USING hnsw (((embedding)::public.halfvec(2048)) public.halfvec_cosine_ops) WITH (m='16', ef_construction='64');



CREATE INDEX ix_document_chunks_org_id ON public.document_chunks USING btree (workspace_id);



CREATE INDEX ix_document_chunks_user_id ON public.document_chunks USING btree (user_id);



CREATE INDEX ix_documents_asset_revision ON public.documents USING btree (asset_id, source_revision_id) WHERE (asset_id IS NOT NULL);



CREATE INDEX ix_documents_conversation_id ON public.documents USING btree (conversation_id);



CREATE INDEX ix_documents_kind ON public.documents USING btree (kind);



CREATE INDEX ix_documents_org_created ON public.documents USING btree (workspace_id, created_at DESC);



CREATE INDEX ix_documents_processing_intent ON public.documents USING btree (processing_dispatched_at NULLS FIRST, updated_at, id) WHERE (((kind)::text = 'source'::text) AND (((ingest_status)::text = ANY (ARRAY[('received'::character varying)::text, ('converting'::character varying)::text])) OR (((ingest_status)::text = 'ready'::text) AND ((index_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('indexing'::character varying)::text])))));



CREATE INDEX ix_documents_user_id ON public.documents USING btree (user_id);



CREATE INDEX ix_file_change_set_entries_change_set ON public.file_change_set_entries USING btree (change_set_id);



CREATE INDEX ix_file_change_sets_root ON public.file_change_sets USING btree (user_id, conversation_id, status);



CREATE INDEX ix_file_entries_conversation ON public.file_entries USING btree (user_id, conversation_id);



CREATE INDEX ix_staged_media_asset_revision ON public.staged_media USING btree (asset_id, revision_id) WHERE (asset_id IS NOT NULL);



CREATE INDEX ix_staged_media_conversation_id ON public.staged_media USING btree (conversation_id);



CREATE INDEX ix_staged_media_org_id ON public.staged_media USING btree (workspace_id);



CREATE INDEX ix_staged_media_user_id ON public.staged_media USING btree (user_id);



ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT fk_document_chunks_document FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
