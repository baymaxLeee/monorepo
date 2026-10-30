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


CREATE TABLE public.apps (
    id character varying(64) NOT NULL,
    title character varying(120) NOT NULL,
    base_path character varying(200) NOT NULL,
    remote_name character varying(120) NOT NULL,
    expose_key character varying(120) DEFAULT './App'::character varying NOT NULL,
    entry character varying(500) DEFAULT ''::character varying NOT NULL,
    requires_admin boolean DEFAULT true NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.asset_claim_intents (
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    owner_type character varying(64) NOT NULL,
    owner_id character varying(128) NOT NULL,
    slot character varying(128) NOT NULL,
    asset_id uuid NOT NULL,
    revision_id uuid NOT NULL,
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



CREATE TABLE public.benefit_package_asset_group_cleanups (
    id character varying(32) NOT NULL,
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    benefit_package_id character varying(32) NOT NULL,
    asset_group_id character varying(128) NOT NULL,
    project_name character varying(128) NOT NULL,
    access_key_id_enc text NOT NULL,
    secret_access_key_enc text NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    lease_token character varying(32) DEFAULT ''::character varying NOT NULL,
    lease_until timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error character varying(512) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT benefit_package_asset_group_cleanups_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT benefit_package_asset_group_cleanups_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('running'::character varying)::text, ('completed'::character varying)::text])))
);



CREATE TABLE public.benefit_package_models (
    package_id character varying(32) NOT NULL,
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    model_id character varying(128) NOT NULL
);



CREATE TABLE public.benefit_package_review_cleanup_claims (
    cleanup_id character varying(32) NOT NULL,
    reservation_id character varying(36) NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT benefit_package_review_cleanup_claims_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('completed'::character varying)::text])))
);



CREATE TABLE public.benefit_package_review_reservations (
    id character varying(36) NOT NULL,
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    benefit_package_id character varying(32) NOT NULL,
    project_id character varying(36) NOT NULL,
    asset_id character varying(36) NOT NULL,
    status character varying(16) DEFAULT 'reserved'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    operation_id character varying(36) NOT NULL,
    CONSTRAINT benefit_package_review_reservations_status_check CHECK (((status)::text = ANY (ARRAY[('reserved'::character varying)::text, ('committed'::character varying)::text, ('releasing'::character varying)::text, ('reacquiring'::character varying)::text, ('released'::character varying)::text])))
);



CREATE TABLE public.benefit_packages (
    id character varying(32) NOT NULL,
    tenant_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    is_preset boolean NOT NULL,
    name character varying(80) NOT NULL,
    project_name character varying(128) NOT NULL,
    asset_group_id character varying(128) NOT NULL,
    access_key_id_enc text NOT NULL,
    secret_access_key_enc text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    model_ids_json text DEFAULT '[]'::text NOT NULL,
    material_used bigint DEFAULT 0 NOT NULL,
    material_limit bigint,
    revision bigint DEFAULT 1 NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_by character varying(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT benefit_packages_material_limit_check CHECK (((material_limit IS NULL) OR (material_limit > 0))),
    CONSTRAINT benefit_packages_material_used_check CHECK ((material_used >= 0)),
    CONSTRAINT benefit_packages_revision_check CHECK ((revision > 0))
);



CREATE TABLE public.bot_skills (
    bot_id character varying(32) NOT NULL,
    skill_id character varying(32) NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);



CREATE TABLE public.bots (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    name character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    text_provider_id character varying(32),
    image_provider_id character varying(32),
    video_provider_id character varying(32),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id character varying(26) NOT NULL,
    role_description text,
    domain_description text,
    audience character varying(200),
    tone character varying(20) DEFAULT 'professional'::character varying NOT NULL,
    welcome_message text,
    suggested_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    tenant_id character varying(26) NOT NULL
);



CREATE TABLE public.canvas_settings (
    workspace_id character varying(26) NOT NULL,
    revision bigint NOT NULL,
    defaults_json text NOT NULL,
    updated_by character varying(26) NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    tenant_id character varying(26) NOT NULL,
    CONSTRAINT canvas_settings_revision_check CHECK ((revision > 0))
);



CREATE TABLE public.model_providers (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    name character varying(100) NOT NULL,
    model character varying(128) NOT NULL,
    base_url character varying(255) NOT NULL,
    api_key_enc text NOT NULL,
    extra_body text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    context_window integer DEFAULT 128000 NOT NULL,
    max_output_tokens integer DEFAULT 8192 NOT NULL,
    provider_kind character varying(16) DEFAULT 'chat'::character varying NOT NULL,
    supports_image_input boolean DEFAULT false NOT NULL,
    workspace_id character varying(26) NOT NULL,
    pricing_json text,
    tenant_id character varying(26) NOT NULL,
    responses_dialect character varying(32),
    CONSTRAINT ck_model_providers_responses_dialect CHECK (((responses_dialect IS NULL) OR ((responses_dialect)::text = ANY (ARRAY[('openai_responses'::character varying)::text, ('ark_responses'::character varying)::text, ('deepseek_responses'::character varying)::text])))),
    CONSTRAINT ck_model_providers_responses_dialect_kind CHECK (((((provider_kind)::text = 'chat'::text) AND (responses_dialect IS NOT NULL)) OR (((provider_kind)::text <> 'chat'::text) AND (responses_dialect IS NULL))))
);



CREATE TABLE public.skill_nodes (
    id character varying(64) NOT NULL,
    skill_id character varying(32) NOT NULL,
    parent_id character varying(64),
    name character varying(255) NOT NULL,
    node_type character varying(16) NOT NULL,
    mime_type character varying(160),
    content text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    storage_kind character varying(20) DEFAULT 'inline'::character varying NOT NULL,
    asset_id uuid,
    revision_id uuid,
    size_bytes bigint,
    sha256 character varying(64),
    CONSTRAINT ck_skill_nodes_sha256 CHECK (((sha256 IS NULL) OR ((sha256)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_skill_nodes_size CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT ck_skill_nodes_storage CHECK (((((node_type)::text = 'directory'::text) AND ((storage_kind)::text = 'inline'::text) AND (content IS NULL) AND (asset_id IS NULL) AND (revision_id IS NULL) AND (size_bytes IS NULL) AND (sha256 IS NULL)) OR (((node_type)::text = 'file'::text) AND ((storage_kind)::text = 'inline'::text) AND (content IS NOT NULL) AND (asset_id IS NULL) AND (revision_id IS NULL)) OR (((node_type)::text = 'file'::text) AND ((storage_kind)::text = 'asset'::text) AND (content IS NULL) AND (asset_id IS NOT NULL) AND (revision_id IS NOT NULL) AND (size_bytes IS NOT NULL) AND (sha256 IS NOT NULL)))),
    CONSTRAINT skill_nodes_check CHECK (((((node_type)::text = 'directory'::text) AND (content IS NULL)) OR ((node_type)::text = 'file'::text))),
    CONSTRAINT skill_nodes_node_type_check CHECK (((node_type)::text = ANY (ARRAY[('file'::character varying)::text, ('directory'::character varying)::text])))
);



CREATE TABLE public.skill_published_nodes (
    skill_id character varying(32) NOT NULL,
    node_id character varying(64) NOT NULL,
    parent_node_id character varying(64),
    name character varying(255) NOT NULL,
    node_type character varying(16) NOT NULL,
    mime_type character varying(160),
    content text,
    sort_order integer DEFAULT 0 NOT NULL,
    storage_kind character varying(20) DEFAULT 'inline'::character varying NOT NULL,
    asset_id uuid,
    revision_id uuid,
    size_bytes bigint,
    sha256 character varying(64),
    CONSTRAINT ck_skill_published_nodes_sha256 CHECK (((sha256 IS NULL) OR ((sha256)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_skill_published_nodes_size CHECK (((size_bytes IS NULL) OR (size_bytes >= 0))),
    CONSTRAINT ck_skill_published_nodes_storage CHECK (((((node_type)::text = 'directory'::text) AND ((storage_kind)::text = 'inline'::text) AND (content IS NULL) AND (asset_id IS NULL) AND (revision_id IS NULL) AND (size_bytes IS NULL) AND (sha256 IS NULL)) OR (((node_type)::text = 'file'::text) AND ((storage_kind)::text = 'inline'::text) AND (content IS NOT NULL) AND (asset_id IS NULL) AND (revision_id IS NULL)) OR (((node_type)::text = 'file'::text) AND ((storage_kind)::text = 'asset'::text) AND (content IS NULL) AND (asset_id IS NOT NULL) AND (revision_id IS NOT NULL) AND (size_bytes IS NOT NULL) AND (sha256 IS NOT NULL)))),
    CONSTRAINT skill_published_nodes_check CHECK (((((node_type)::text = 'directory'::text) AND (content IS NULL)) OR ((node_type)::text = 'file'::text))),
    CONSTRAINT skill_published_nodes_node_type_check CHECK (((node_type)::text = ANY (ARRAY[('file'::character varying)::text, ('directory'::character varying)::text])))
);



CREATE TABLE public.skills (
    id character varying(32) NOT NULL,
    user_id character varying(26) NOT NULL,
    workspace_id character varying(26) NOT NULL,
    username character varying(120) NOT NULL,
    name character varying(64) NOT NULL,
    description character varying(1024) DEFAULT ''::character varying NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workspace_seq integer DEFAULT 1 NOT NULL,
    workspace_sha256 character varying(64),
    published_sha256 character varying(64),
    published_at timestamp with time zone,
    published_name character varying(64),
    published_description character varying(1024),
    tenant_id character varying(26) NOT NULL,
    source_archive_asset_id uuid,
    source_archive_revision_id uuid,
    CONSTRAINT ck_skills_source_archive CHECK ((((source_archive_asset_id IS NULL) AND (source_archive_revision_id IS NULL)) OR ((source_archive_asset_id IS NOT NULL) AND (source_archive_revision_id IS NOT NULL))))
);



ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.asset_claim_intents
    ADD CONSTRAINT asset_claim_intents_pkey PRIMARY KEY (tenant_id, workspace_id, owner_type, owner_id, slot);



ALTER TABLE ONLY public.benefit_package_asset_group_cleanups
    ADD CONSTRAINT benefit_package_asset_group_cleanups_asset_group_id_key UNIQUE (asset_group_id);



ALTER TABLE ONLY public.benefit_package_asset_group_cleanups
    ADD CONSTRAINT benefit_package_asset_group_cleanups_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.benefit_package_models
    ADD CONSTRAINT benefit_package_models_pkey PRIMARY KEY (package_id, model_id);



ALTER TABLE ONLY public.benefit_package_models
    ADD CONSTRAINT benefit_package_models_scope_model UNIQUE (tenant_id, workspace_id, model_id);



ALTER TABLE ONLY public.benefit_package_review_cleanup_claims
    ADD CONSTRAINT benefit_package_review_cleanup_claims_pkey PRIMARY KEY (cleanup_id);



ALTER TABLE ONLY public.benefit_package_review_reservations
    ADD CONSTRAINT benefit_package_review_reservations_operation UNIQUE (operation_id);



ALTER TABLE ONLY public.benefit_package_review_reservations
    ADD CONSTRAINT benefit_package_review_reservations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.benefit_packages
    ADD CONSTRAINT benefit_packages_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.bot_skills
    ADD CONSTRAINT bot_skills_pkey PRIMARY KEY (bot_id, skill_id);



ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.canvas_settings
    ADD CONSTRAINT canvas_settings_pkey PRIMARY KEY (workspace_id);



ALTER TABLE ONLY public.model_providers
    ADD CONSTRAINT model_providers_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.skill_nodes
    ADD CONSTRAINT skill_nodes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.skill_published_nodes
    ADD CONSTRAINT skill_published_nodes_pkey PRIMARY KEY (skill_id, node_id);



ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);



CREATE INDEX benefit_package_asset_group_cleanups_scope ON public.benefit_package_asset_group_cleanups USING btree (tenant_id, workspace_id, status, updated_at DESC);



CREATE INDEX benefit_package_models_scope ON public.benefit_package_models USING btree (tenant_id, workspace_id, package_id);



CREATE INDEX benefit_package_review_cleanup_claims_reservation ON public.benefit_package_review_cleanup_claims USING btree (reservation_id, status);



CREATE UNIQUE INDEX benefit_package_review_reservations_active ON public.benefit_package_review_reservations USING btree (benefit_package_id, project_id, asset_id) WHERE ((status)::text = ANY (ARRAY[('reserved'::character varying)::text, ('committed'::character varying)::text, ('releasing'::character varying)::text, ('reacquiring'::character varying)::text]));



CREATE INDEX benefit_package_review_reservations_scope ON public.benefit_package_review_reservations USING btree (tenant_id, workspace_id, benefit_package_id, status);



CREATE UNIQUE INDEX benefit_packages_asset_group ON public.benefit_packages USING btree (asset_group_id) WHERE (deleted_at IS NULL);



CREATE UNIQUE INDEX benefit_packages_name ON public.benefit_packages USING btree (tenant_id, workspace_id, name) WHERE (deleted_at IS NULL);



CREATE UNIQUE INDEX benefit_packages_preset ON public.benefit_packages USING btree (tenant_id, workspace_id) WHERE (is_preset AND (deleted_at IS NULL));



CREATE INDEX ix_admin_asset_claim_intents_delivery ON public.asset_claim_intents USING btree (next_attempt_at, lease_until, updated_at, owner_id) WHERE (delivered_at IS NULL);



CREATE INDEX ix_apps_enabled_visibility ON public.apps USING btree (is_enabled, requires_admin);



CREATE INDEX ix_bot_skills_skill_id ON public.bot_skills USING btree (skill_id);



CREATE INDEX ix_bots_org_id ON public.bots USING btree (workspace_id);



CREATE INDEX ix_bots_user_id ON public.bots USING btree (user_id);



CREATE INDEX ix_model_providers_org_id ON public.model_providers USING btree (workspace_id);



CREATE INDEX ix_model_providers_user_id ON public.model_providers USING btree (user_id);



CREATE INDEX ix_skill_nodes_parent_id ON public.skill_nodes USING btree (parent_id);



CREATE INDEX ix_skill_nodes_skill_id ON public.skill_nodes USING btree (skill_id);



CREATE INDEX ix_skill_published_nodes_parent ON public.skill_published_nodes USING btree (skill_id, parent_node_id);



CREATE INDEX ix_skills_org_id ON public.skills USING btree (workspace_id);



CREATE INDEX ix_skills_user_id ON public.skills USING btree (user_id);



CREATE UNIQUE INDEX ux_skill_nodes_child_name ON public.skill_nodes USING btree (skill_id, parent_id, name) WHERE (parent_id IS NOT NULL);



CREATE UNIQUE INDEX ux_skill_nodes_root_name ON public.skill_nodes USING btree (skill_id, name) WHERE (parent_id IS NULL);



CREATE UNIQUE INDEX ux_skills_org_name ON public.skills USING btree (workspace_id, name);



ALTER TABLE ONLY public.benefit_package_models
    ADD CONSTRAINT benefit_package_models_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.benefit_packages(id);



ALTER TABLE ONLY public.benefit_package_review_cleanup_claims
    ADD CONSTRAINT benefit_package_review_cleanup_claims_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.benefit_package_review_reservations(id);



ALTER TABLE ONLY public.benefit_package_review_reservations
    ADD CONSTRAINT benefit_package_review_reservations_benefit_package_id_fkey FOREIGN KEY (benefit_package_id) REFERENCES public.benefit_packages(id);



ALTER TABLE ONLY public.skill_nodes
    ADD CONSTRAINT skill_nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.skill_nodes(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.skill_nodes
    ADD CONSTRAINT skill_nodes_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.skill_published_nodes
    ADD CONSTRAINT skill_published_nodes_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;
