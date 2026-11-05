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


CREATE TABLE public.asset_claims (
    id uuid NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    owner_service character varying(32) NOT NULL,
    owner_type character varying(64) NOT NULL,
    owner_id character varying(128) NOT NULL,
    slot character varying(128) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid,
    kind character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    generation bigint NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    released_at timestamp with time zone,
    CONSTRAINT asset_claims_generation_check CHECK ((generation > 0)),
    CONSTRAINT asset_claims_kind_check CHECK (((kind)::text = ANY (ARRAY[('strong'::character varying)::text, ('snapshot'::character varying)::text, ('lease'::character varying)::text, ('weak'::character varying)::text]))),
    CONSTRAINT asset_claims_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('active'::character varying)::text, ('released'::character varying)::text])))
);



CREATE TABLE public.asset_lineage (
    output_revision_id uuid NOT NULL,
    input_revision_id uuid NOT NULL,
    relation character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT asset_lineage_check CHECK ((output_revision_id <> input_revision_id))
);



CREATE TABLE public.asset_revisions (
    id uuid NOT NULL,
    asset_id uuid NOT NULL,
    blob_id uuid NOT NULL,
    revision_number bigint NOT NULL,
    filename character varying(255) NOT NULL,
    media_type character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 character(64) NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT asset_revisions_revision_number_check CHECK ((revision_number > 0)),
    CONSTRAINT asset_revisions_size_bytes_check CHECK ((size_bytes >= 0))
);



CREATE TABLE public.assets (
    id uuid NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    category character varying(64) NOT NULL,
    current_revision_id uuid,
    state character varying(20) NOT NULL,
    blocking_claim_count bigint DEFAULT 0 NOT NULL,
    candidate_at timestamp with time zone,
    delete_after timestamp with time zone,
    state_version bigint DEFAULT 1 NOT NULL,
    deletion_attempts integer DEFAULT 0 NOT NULL,
    last_error_code character varying(64),
    created_by character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT assets_blocking_claim_count_check CHECK ((blocking_claim_count >= 0)),
    CONSTRAINT assets_state_check CHECK (((state)::text = ANY (ARRAY[('active'::character varying)::text, ('candidate'::character varying)::text, ('deleting'::character varying)::text, ('deleted'::character varying)::text, ('quarantined'::character varying)::text])))
);



CREATE TABLE public.blobs (
    id uuid NOT NULL,
    tenant_id character varying(64) NOT NULL,
    sha256 character(64) NOT NULL,
    size_bytes bigint NOT NULL,
    storage_key character varying(512) NOT NULL,
    state character varying(20) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    deleting_at timestamp with time zone,
    deletion_owner_asset_id uuid,
    state_version bigint DEFAULT 1 NOT NULL,
    CONSTRAINT blobs_size_bytes_check CHECK ((size_bytes >= 0)),
    CONSTRAINT blobs_state_check CHECK (((state)::text = ANY (ARRAY[('active'::character varying)::text, ('deleting'::character varying)::text, ('deleted'::character varying)::text, ('damaged'::character varying)::text])))
);



CREATE TABLE public.upload_sessions (
    id uuid NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    user_id character varying(64) NOT NULL,
    caller_service character varying(64) NOT NULL,
    idempotency_key character varying(255),
    category character varying(64) NOT NULL,
    filename character varying(255) NOT NULL,
    declared_media_type character varying(255) NOT NULL,
    declared_size_bytes bigint,
    state character varying(20) NOT NULL,
    asset_id uuid,
    revision_id uuid,
    error_code character varying(64),
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT upload_sessions_declared_size_bytes_check CHECK ((declared_size_bytes >= 0)),
    CONSTRAINT upload_sessions_state_check CHECK (((state)::text = ANY (ARRAY[('pending'::character varying)::text, ('uploading'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('aborted'::character varying)::text])))
);



ALTER TABLE ONLY public.asset_claims
    ADD CONSTRAINT asset_claims_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.asset_claims
    ADD CONSTRAINT asset_claims_tenant_id_workspace_id_owner_service_owner_typ_key UNIQUE (tenant_id, workspace_id, owner_service, owner_type, owner_id, slot);



ALTER TABLE ONLY public.asset_lineage
    ADD CONSTRAINT asset_lineage_pkey PRIMARY KEY (output_revision_id, input_revision_id, relation);



ALTER TABLE ONLY public.asset_revisions
    ADD CONSTRAINT asset_revisions_asset_id_revision_number_key UNIQUE (asset_id, revision_number);



ALTER TABLE ONLY public.asset_revisions
    ADD CONSTRAINT asset_revisions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.blobs
    ADD CONSTRAINT blobs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.blobs
    ADD CONSTRAINT blobs_storage_key_key UNIQUE (storage_key);



ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_pkey PRIMARY KEY (id);



CREATE INDEX ix_asset_claims_blocking ON public.asset_claims USING btree (asset_id, status, kind);



CREATE INDEX ix_asset_claims_lease_expiry ON public.asset_claims USING btree (expires_at) WHERE (((kind)::text = 'lease'::text) AND ((status)::text <> 'released'::text));



CREATE INDEX ix_asset_revisions_blob ON public.asset_revisions USING btree (blob_id);



CREATE INDEX ix_assets_gc_scan ON public.assets USING btree (state, blocking_claim_count, updated_at, id);



CREATE INDEX ix_assets_tenant_workspace ON public.assets USING btree (tenant_id, workspace_id, created_at DESC);



CREATE INDEX ix_blobs_deletion_owner ON public.blobs USING btree (deletion_owner_asset_id) WHERE ((state)::text = 'deleting'::text);



CREATE INDEX ix_upload_sessions_expiry ON public.upload_sessions USING btree (state, expires_at);



CREATE UNIQUE INDEX uq_upload_sessions_idempotency ON public.upload_sessions USING btree (tenant_id, workspace_id, caller_service, idempotency_key) WHERE (idempotency_key IS NOT NULL);



CREATE UNIQUE INDEX ux_blobs_active_content ON public.blobs USING btree (tenant_id, sha256, size_bytes) WHERE ((state)::text = 'active'::text);



ALTER TABLE ONLY public.asset_claims
    ADD CONSTRAINT asset_claims_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);



ALTER TABLE ONLY public.asset_claims
    ADD CONSTRAINT asset_claims_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.asset_revisions(id);



ALTER TABLE ONLY public.asset_lineage
    ADD CONSTRAINT asset_lineage_input_revision_id_fkey FOREIGN KEY (input_revision_id) REFERENCES public.asset_revisions(id);



ALTER TABLE ONLY public.asset_lineage
    ADD CONSTRAINT asset_lineage_output_revision_id_fkey FOREIGN KEY (output_revision_id) REFERENCES public.asset_revisions(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.asset_revisions
    ADD CONSTRAINT asset_revisions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.asset_revisions
    ADD CONSTRAINT asset_revisions_blob_id_fkey FOREIGN KEY (blob_id) REFERENCES public.blobs(id);



ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_assets_current_revision FOREIGN KEY (current_revision_id) REFERENCES public.asset_revisions(id) DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY public.blobs
    ADD CONSTRAINT fk_blobs_deletion_owner FOREIGN KEY (deletion_owner_asset_id) REFERENCES public.assets(id);



ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);



ALTER TABLE ONLY public.upload_sessions
    ADD CONSTRAINT upload_sessions_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.asset_revisions(id);
