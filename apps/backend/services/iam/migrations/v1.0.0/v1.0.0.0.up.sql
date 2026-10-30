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


CREATE TABLE public.iam_audit_events (
    id character varying(26) NOT NULL,
    action character varying(64) NOT NULL,
    actor_user_id character varying(26),
    target_user_id character varying(26),
    workspace_id character varying(26),
    before_json jsonb,
    after_json jsonb,
    result character varying(16) NOT NULL,
    reason character varying(255),
    trace_id character varying(64),
    created_at timestamp with time zone NOT NULL
);



CREATE TABLE public.refresh_tokens (
    id character varying(26) NOT NULL,
    user_id character varying(26) NOT NULL,
    token_hash character(44) NOT NULL,
    user_agent character varying(512) DEFAULT ''::character varying NOT NULL,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    replaced_by_token_id character varying(26),
    active_workspace_id character varying(26)
);



CREATE TABLE public.roles (
    id character varying(26) NOT NULL,
    name character varying(64) NOT NULL,
    description character varying(255) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.tenants (
    id character varying(26) NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



CREATE TABLE public.user_credentials (
    user_id character varying(26) NOT NULL,
    password_hash character varying(255) NOT NULL,
    password_changed_at timestamp with time zone NOT NULL,
    failed_attempts bigint DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.user_roles (
    user_id character varying(26) NOT NULL,
    role_id character varying(26) NOT NULL,
    created_at timestamp with time zone NOT NULL
);



CREATE TABLE public.users (
    id character varying(26) NOT NULL,
    account character varying(64) NOT NULL,
    email character varying(320) NOT NULL,
    email_normalized character varying(320) NOT NULL,
    display_name character varying(120) NOT NULL,
    avatar_url character varying(2048) DEFAULT ''::character varying NOT NULL,
    phone character varying(32) DEFAULT ''::character varying NOT NULL,
    locale character varying(16) DEFAULT 'zh-CN'::character varying NOT NULL,
    timezone character varying(64) DEFAULT 'Asia/Shanghai'::character varying NOT NULL,
    theme character varying(20) DEFAULT 'system'::character varying NOT NULL,
    marketing_opt_in boolean DEFAULT false NOT NULL,
    email_verified_at timestamp with time zone,
    disabled_at timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);



CREATE TABLE public.workspace_members (
    workspace_id character varying(26) NOT NULL,
    user_id character varying(26) NOT NULL,
    role character varying(32) DEFAULT 'member'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by character varying(26),
    reviewed_at timestamp with time zone,
    rejection_reason character varying(255),
    CONSTRAINT chk_org_members_status CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('active'::character varying)::text, ('rejected'::character varying)::text]))),
    CONSTRAINT chk_workspace_members_role CHECK (((role)::text = ANY (ARRAY[('workspace_admin'::character varying)::text, ('member'::character varying)::text])))
);



CREATE TABLE public.workspaces (
    id character varying(26) NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(64) NOT NULL,
    owner_user_id character varying(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    system_managed boolean DEFAULT false NOT NULL,
    system_key character varying(32),
    join_policy character varying(16) DEFAULT 'approval'::character varying NOT NULL,
    tenant_id character varying(26) NOT NULL,
    CONSTRAINT chk_organizations_join_policy CHECK (((join_policy)::text = ANY (ARRAY[('open'::character varying)::text, ('approval'::character varying)::text]))),
    CONSTRAINT chk_workspaces_system_shape CHECK ((((NOT system_managed) AND (system_key IS NULL) AND ((join_policy)::text = 'approval'::text)) OR (system_managed AND ((system_key)::text = 'guest-workspace'::text) AND ((join_policy)::text = 'open'::text))))
);



ALTER TABLE ONLY public.iam_audit_events
    ADD CONSTRAINT iam_audit_events_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (workspace_id, user_id);



ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);



ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT uq_organizations_slug UNIQUE (slug);



ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT uq_organizations_system_key UNIQUE (system_key);



ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash);



ALTER TABLE ONLY public.roles
    ADD CONSTRAINT uq_roles_name UNIQUE (name);



ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_account UNIQUE (account);



ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized);



ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id);



ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);



ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);



CREATE INDEX idx_iam_audit_action_created ON public.iam_audit_events USING btree (action, created_at);



CREATE INDEX idx_iam_audit_actor ON public.iam_audit_events USING btree (actor_user_id);



CREATE INDEX idx_iam_audit_org ON public.iam_audit_events USING btree (workspace_id);



CREATE INDEX idx_org_members_org_status_created ON public.workspace_members USING btree (workspace_id, status, created_at);



CREATE INDEX idx_org_members_user ON public.workspace_members USING btree (user_id);



CREATE INDEX idx_org_members_user_status ON public.workspace_members USING btree (user_id, status);



CREATE INDEX idx_organizations_owner ON public.workspaces USING btree (owner_user_id);



CREATE INDEX idx_refresh_tokens_expires_at ON public.refresh_tokens USING btree (expires_at);



CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id);



CREATE INDEX idx_user_roles_role_id ON public.user_roles USING btree (role_id);



CREATE INDEX idx_users_created_at ON public.users USING btree (created_at);



CREATE INDEX idx_workspaces_tenant ON public.workspaces USING btree (tenant_id);



ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT fk_org_members_org FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT fk_org_members_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT fk_refresh_tokens_active_org FOREIGN KEY (active_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT fk_user_credentials_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
