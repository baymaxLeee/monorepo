--
-- PostgreSQL database dump
--

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg12+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: asset_gc_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_gc_candidates (
    asset_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    artifact_id character varying(128) NOT NULL,
    deleted_at timestamp(3) with time zone NOT NULL,
    purge_not_before timestamp(3) with time zone NOT NULL,
    next_attempt_at timestamp(3) with time zone NOT NULL,
    lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    state_version bigint NOT NULL,
    attempts integer NOT NULL,
    last_error character varying(512) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    artifact_namespace character varying(64) DEFAULT NULL::character varying
);


--
-- Name: asset_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_references (
    asset_id uuid NOT NULL,
    owner_type character varying(60) NOT NULL,
    owner_key character varying(60) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint DEFAULT 0 NOT NULL
);


--
-- Name: asset_review_cleanup_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_review_cleanup_outbox (
    review_id character(36) NOT NULL,
    asset_id character(36) NOT NULL,
    package_id character varying(64) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    provider_asset_id character varying(128) DEFAULT ''::character varying NOT NULL,
    reservation_id character varying(64) NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    next_attempt_at timestamp(3) with time zone NOT NULL,
    lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    state_version bigint NOT NULL,
    attempts integer NOT NULL,
    last_error character varying(512) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: asset_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_reviews (
    id character(36) NOT NULL,
    task_run_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    project_id character(36) NOT NULL,
    package_id character varying(64) NOT NULL,
    package_name character varying(80) NOT NULL,
    model_ids text NOT NULL,
    system_preset_models boolean NOT NULL,
    asset_id character(36) NOT NULL,
    provider_asset_id character varying(128) DEFAULT ''::character varying NOT NULL,
    reservation_id character varying(64) DEFAULT ''::character varying NOT NULL,
    status character varying(32) NOT NULL,
    failure_reason character varying(512) DEFAULT ''::character varying NOT NULL,
    submission_started_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    submitted_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint DEFAULT 0 NOT NULL
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    owner_type smallint NOT NULL,
    owner_id character(36) NOT NULL,
    creation_key character varying(255) DEFAULT NULL::character varying,
    artifact_id character varying(128) NOT NULL,
    file_name character varying(512) NOT NULL,
    media_type smallint NOT NULL,
    content_type character varying(128) NOT NULL,
    size_bytes bigint NOT NULL,
    billing_class character varying(16) NOT NULL,
    reference_count integer DEFAULT 0 NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint,
    artifact_namespace character varying(64) DEFAULT NULL::character varying
);


--
-- Name: async_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.async_dispatches (
    task_run_id character(36) NOT NULL,
    run_type character varying(64) NOT NULL,
    delivery_state character varying(32) NOT NULL,
    execution_state character varying(32) NOT NULL,
    next_dispatch_at timestamp(3) with time zone NOT NULL,
    publish_lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    execution_lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    execution_token character varying(36) NOT NULL,
    delivery_version bigint NOT NULL,
    execution_version bigint NOT NULL,
    publish_attempts integer NOT NULL,
    execution_attempts integer NOT NULL,
    execution_failures integer NOT NULL,
    lease_recoveries integer NOT NULL,
    first_started_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    last_error_code character varying(128) NOT NULL,
    last_error_message text NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: async_execution_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.async_execution_events (
    id character(36) NOT NULL,
    task_run_id character(36) NOT NULL,
    run_type character varying(64) NOT NULL,
    execution_token character varying(36) NOT NULL,
    sequence integer NOT NULL,
    event_type character varying(32) NOT NULL,
    payload_version integer NOT NULL,
    payload jsonb NOT NULL,
    payload_sha256 character varying(64) NOT NULL,
    terminal_slot smallint,
    consume_status character varying(32) NOT NULL,
    next_consume_at timestamp(3) with time zone NOT NULL,
    consume_lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    consume_attempts integer NOT NULL,
    state_version bigint NOT NULL,
    last_error_code character varying(128) NOT NULL,
    last_error_message text NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    consumed_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone
);


--
-- Name: canvas_node_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvas_node_generations (
    task_run_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    canvas_id character(36) NOT NULL,
    node_id character(36) NOT NULL,
    hidden_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    status character varying(32) NOT NULL,
    provider_status character varying(32) NOT NULL,
    model_service_id character varying(128) NOT NULL,
    resolution smallint NOT NULL,
    aspect_ratio smallint NOT NULL,
    duration_seconds integer NOT NULL,
    output_duration_seconds integer,
    generate_audio boolean NOT NULL,
    watermark boolean NOT NULL,
    prompt text NOT NULL,
    aigw_trace_workspace_id character varying(128) NOT NULL,
    provider_task_id character varying(128) DEFAULT NULL::character varying,
    provider_video_url text NOT NULL,
    provider_error_code character varying(128) NOT NULL,
    provider_error_message text NOT NULL,
    asset_id character(36) DEFAULT NULL::bpchar,
    first_last_frame_task_run_id character varying(64) DEFAULT NULL::character varying,
    first_frame_checkpoint_id character varying(64) DEFAULT NULL::character varying,
    last_frame_checkpoint_id character varying(64) DEFAULT NULL::character varying,
    first_frame_checkpoint_size_bytes bigint DEFAULT '0'::bigint NOT NULL,
    last_frame_checkpoint_size_bytes bigint DEFAULT '0'::bigint NOT NULL,
    first_frame_asset_id character(36) DEFAULT NULL::bpchar,
    last_frame_asset_id character(36) DEFAULT NULL::bpchar,
    inputs jsonb,
    error_message text NOT NULL,
    created_by character varying(64) NOT NULL,
    completed_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    real_task_id character varying(128) DEFAULT NULL::character varying
);


--
-- Name: canvas_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvas_nodes (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    canvas_id character(36) NOT NULL,
    type smallint NOT NULL,
    storyboard_rank bigint NOT NULL,
    asset_id character(36) DEFAULT NULL::bpchar,
    resource_asset_id character(36) DEFAULT NULL::bpchar,
    revision bigint NOT NULL,
    active_task_run_id character(36) DEFAULT NULL::bpchar,
    selected_output_id character(36) DEFAULT NULL::bpchar,
    selected_asset_id character(36) DEFAULT NULL::bpchar,
    created_by character varying(64) NOT NULL,
    updated_by character varying(64) DEFAULT ''::character varying NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint,
    resource_id character(36) DEFAULT NULL::bpchar,
    node_data jsonb NOT NULL
);


--
-- Name: canvas_storyboard_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvas_storyboard_drafts (
    task_run_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    canvas_id character(36) NOT NULL,
    created_by character varying(64) NOT NULL,
    resolved_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    plot text NOT NULL,
    video_model_service_id character varying(128) NOT NULL,
    inference_model_service_id character varying(128) DEFAULT ''::character varying NOT NULL,
    video_resolution smallint NOT NULL,
    video_aspect_ratio smallint NOT NULL,
    video_generate_audio boolean NOT NULL,
    video_watermark boolean NOT NULL,
    canvas_node_duration_min_seconds integer DEFAULT 0 NOT NULL,
    canvas_node_duration_max_seconds integer DEFAULT 0 NOT NULL,
    total_duration_min_seconds integer DEFAULT 0 NOT NULL,
    total_duration_max_seconds integer DEFAULT 0 NOT NULL,
    max_canvas_nodes integer NOT NULL,
    status character varying(32) NOT NULL,
    drafts_json text NOT NULL,
    error_code character varying(128) NOT NULL,
    error_message text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    updated_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    diagnostics_json text NOT NULL,
    protocol_version integer DEFAULT 1 NOT NULL,
    source_beats_json text,
    plan_json text
);

CREATE TABLE public.canvas_text_generations (
    task_run_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64),
    project_id character(36) NOT NULL,
    canvas_id character(36) NOT NULL,
    node_id character(36) NOT NULL,
    created_by character varying(64) NOT NULL,
    prompt text NOT NULL,
    model_service_id character varying(128) NOT NULL,
    inputs jsonb,
    content text NOT NULL,
    status character varying(32) NOT NULL,
    error_code character varying(128) NOT NULL,
    error_message text NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    finished_at timestamp(3) with time zone
);


--
-- Name: canvas_video_archive_export_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvas_video_archive_export_inputs (
    task_run_id character(36) NOT NULL,
    inputs jsonb NOT NULL,
    created_at timestamp(3) with time zone NOT NULL
);


--
-- Name: canvas_video_archive_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvas_video_archive_exports (
    task_run_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    canvas_id character(36) NOT NULL,
    status character varying(32) NOT NULL,
    error_code character varying(128) NOT NULL,
    error_message text NOT NULL,
    input_count integer NOT NULL,
    output_filename character varying(255) NOT NULL,
    output_path character varying(512) NOT NULL,
    output_size bigint NOT NULL,
    output_sha256 character varying(64) NOT NULL,
    upload_id character varying(255) NOT NULL,
    part_size bigint NOT NULL,
    created_by character varying(64) NOT NULL,
    retention_started_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    retention_guaranteed_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    cleanup_status character varying(32) NOT NULL,
    cleanup_next_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    cleanup_lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    cleanup_state_version bigint NOT NULL,
    cleanup_attempts integer NOT NULL,
    cleanup_last_error text NOT NULL,
    started_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    finished_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);

CREATE TABLE public.canvas_archive_workflows (
    task_run_id character(36) NOT NULL,
    executor_task_id character varying(32) NOT NULL DEFAULT '',
    cancel_requested boolean NOT NULL DEFAULT false,
    settled boolean NOT NULL DEFAULT false,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: canvases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canvases (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    name character varying(80) NOT NULL,
    cover_image_path character varying(128) DEFAULT NULL::character varying,
    cover_image_id character(36) DEFAULT NULL::bpchar,
    cover_image_sha256 character varying(64) DEFAULT NULL::character varying,
    cover_image_size_bytes bigint DEFAULT '0'::bigint NOT NULL,
    canvas_node_count integer DEFAULT 0 NOT NULL,
    selected_video_duration_millis bigint DEFAULT '0'::bigint NOT NULL,
    default_view smallint DEFAULT '1'::smallint NOT NULL,
    revision bigint DEFAULT '1'::bigint NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: deletion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_jobs (
    id character varying(64) NOT NULL,
    tenant_id character varying(255) NOT NULL,
    kind character varying(64) NOT NULL,
    payload jsonb NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    state_version bigint NOT NULL,
    attempts integer NOT NULL,
    completed_at timestamp with time zone,
    last_error text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: image_generation_run_inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_generation_run_inputs (
    id bigint NOT NULL,
    task_run_id character(36) NOT NULL,
    "position" integer NOT NULL,
    source_type character varying(32) NOT NULL,
    asset_id character(36) NOT NULL
);


--
-- Name: image_generation_run_inputs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.image_generation_run_inputs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.image_generation_run_inputs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: image_generation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_generation_runs (
    task_run_id character(36) NOT NULL,
    target_type character varying(64) NOT NULL,
    target_id character(36) NOT NULL,
    target_revision bigint NOT NULL,
    tenant_id character varying(64) NOT NULL,
    invocation_project_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    prompt text NOT NULL,
    model_id character varying(128) NOT NULL,
    resolution character varying(16) NOT NULL,
    aspect_ratio character varying(16) NOT NULL,
    watermark boolean NOT NULL,
    input_snapshots jsonb,
    output_owner_type smallint NOT NULL,
    output_owner_id character(36) NOT NULL,
    binding_outcome character varying(32) NOT NULL,
    stage character varying(32) NOT NULL,
    provider_attempt integer NOT NULL,
    provider_image_url text NOT NULL,
    artifact_id character varying(128) NOT NULL,
    artifact_size_bytes bigint NOT NULL,
    output_asset_id character(36) DEFAULT NULL::bpchar,
    error_code character varying(128) NOT NULL,
    error_message text NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    completed_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone
);


--
-- Name: official_asset_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_asset_blobs (
    id bigint NOT NULL,
    slug character varying(255) NOT NULL,
    file_sha256 character varying(64) NOT NULL,
    blob_id character varying(255) DEFAULT NULL::character varying,
    status smallint DEFAULT '1'::smallint NOT NULL,
    lease_owner character varying(64) DEFAULT NULL::character varying,
    lease_expires_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    file_name character varying(512) NOT NULL,
    content_type character varying(255) NOT NULL,
    size_bytes bigint DEFAULT '0'::bigint NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: official_asset_blobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.official_asset_blobs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.official_asset_blobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: official_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.official_assets (
    id bigint NOT NULL,
    slug character varying(255) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    workspace_key character varying(64) DEFAULT ''::character varying NOT NULL,
    artifact_id character varying(128) DEFAULT NULL::character varying,
    internal_asset_id character(36) DEFAULT NULL::bpchar,
    resource_id character(36) DEFAULT NULL::bpchar,
    resource_asset_id character(36) DEFAULT NULL::bpchar,
    long_live_status smallint DEFAULT '1'::smallint NOT NULL,
    file_sha256 character varying(64) DEFAULT NULL::character varying,
    file_name character varying(512) DEFAULT ''::character varying NOT NULL,
    media_type smallint NOT NULL,
    size_bytes bigint DEFAULT '0'::bigint NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: official_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.official_assets ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.official_assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: poll_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poll_schedules (
    task_run_id character(36) NOT NULL,
    next_poll_at timestamp(3) with time zone NOT NULL,
    lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    state_version bigint NOT NULL,
    poll_attempts integer NOT NULL,
    consecutive_errors integer NOT NULL,
    deadline_at timestamp(3) with time zone NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: preset_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_skills (
    skill_key character varying(128) NOT NULL,
    asset_center_skill_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    default_bound boolean NOT NULL,
    state character varying(16) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    id bigint NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    user_id character varying(64) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: project_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.project_members ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.project_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: project_resource_rel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_resource_rel (
    id bigint NOT NULL,
    project_id character(36) NOT NULL,
    resource_id character(36) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: project_resource_rel_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.project_resource_rel ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.project_resource_rel_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Monorepo replaces AgentFrame's AIGW-owned project usage policy with a
-- service-owned PostgreSQL gateway. Keep that deployment adaptation in the
-- consolidated schema while the application-level project flow stays aligned
-- with AgentFrame.
CREATE TABLE public.project_usage_policies (
    project_id character varying(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) NOT NULL,
    usage_limit_micros bigint,
    used_amount_micros bigint DEFAULT 0 NOT NULL,
    reserved_amount_micros bigint DEFAULT 0 NOT NULL,
    currency character varying(16) DEFAULT 'CNY'::character varying NOT NULL,
    CONSTRAINT project_usage_policies_pkey PRIMARY KEY (project_id),
    CONSTRAINT project_usage_policies_reserved_nonnegative CHECK ((reserved_amount_micros >= 0)),
    CONSTRAINT project_usage_policies_used_nonnegative CHECK ((used_amount_micros >= 0)),
    CONSTRAINT project_usage_policies_limit_positive CHECK (((usage_limit_micros IS NULL) OR (usage_limit_micros > 0)))
);


--
-- Name: project_usage_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_usage_records (
    task_run_id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    project_id character(36) NOT NULL,
    run_type character varying(64) NOT NULL,
    resource_type character varying(64) NOT NULL,
    model_id character varying(128) NOT NULL,
    model_name character varying(255) NOT NULL,
    model_source character varying(128) NOT NULL,
    created_by character varying(64) NOT NULL,
    created_by_name character varying(191) NOT NULL,
    created_by_name_resolved_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    consumed_at timestamp(3) with time zone NOT NULL,
    call_count integer NOT NULL,
    final_call_count integer NOT NULL,
    billing_status character varying(32) NOT NULL,
    total_amount numeric(38,18) DEFAULT NULL::numeric,
    currency character varying(16) DEFAULT NULL::character varying,
    billing_attempts integer NOT NULL,
    no_progress_attempts integer NOT NULL,
    next_attempt_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    lease_owner character varying(128) NOT NULL,
    lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    state_version bigint NOT NULL,
    review_reason text NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    billing_finalized_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    name character varying(80) NOT NULL,
    created_by character varying(64) NOT NULL,
    cover_image_path character varying(128) DEFAULT NULL::character varying,
    cover_image_id character(36) DEFAULT NULL::bpchar,
    cover_image_sha256 character varying(64) DEFAULT NULL::character varying,
    cover_image_size_bytes bigint DEFAULT '0'::bigint NOT NULL,
    canvas_count integer DEFAULT 0 NOT NULL,
    selected_video_duration_millis bigint DEFAULT '0'::bigint NOT NULL,
    resource_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: resource_asset_image_generation_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_asset_image_generation_drafts (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    resource_id character(36) NOT NULL,
    resource_asset_id character(36) NOT NULL,
    prompt text NOT NULL,
    model_id character varying(128) NOT NULL,
    resolution character varying(16) NOT NULL,
    aspect_ratio character varying(16) NOT NULL,
    watermark boolean NOT NULL,
    revision bigint NOT NULL,
    active_task_run_id character(36) DEFAULT NULL::bpchar,
    created_by character varying(64) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: resource_asset_image_generation_resource_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_asset_image_generation_resource_references (
    id bigint NOT NULL,
    draft_id character(36) NOT NULL,
    "position" integer NOT NULL,
    resource_id character(36) NOT NULL,
    sequence_no bigint NOT NULL
);


--
-- Name: resource_asset_image_generation_resource_references_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.resource_asset_image_generation_resource_references ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.resource_asset_image_generation_resource_references_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: resource_asset_image_generation_uploaded_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_asset_image_generation_uploaded_references (
    id bigint NOT NULL,
    draft_id character(36) NOT NULL,
    "position" integer NOT NULL,
    asset_id character(36) NOT NULL
);


--
-- Name: resource_asset_image_generation_uploaded_references_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.resource_asset_image_generation_uploaded_references ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.resource_asset_image_generation_uploaded_references_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: resource_asset_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_asset_revisions (
    id bigint NOT NULL,
    resource_asset_id character(36) NOT NULL,
    asset_id character(36) NOT NULL,
    media_type smallint NOT NULL,
    revision_no bigint NOT NULL,
    created_at timestamp(3) with time zone NOT NULL
);


--
-- Name: resource_asset_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.resource_asset_revisions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.resource_asset_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: resource_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_assets (
    id character(36) NOT NULL,
    resource_id character(36) NOT NULL,
    name character varying(128) NOT NULL,
    sequence_no bigint NOT NULL,
    source_type smallint NOT NULL,
    current_asset_id character(36) DEFAULT NULL::bpchar,
    image_generation_draft_id character(36) DEFAULT NULL::bpchar,
    media_type smallint NOT NULL,
    revision bigint NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: resource_quota_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_quota_reservations (
    id character varying(64) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    resource_type character varying(64) NOT NULL,
    idempotency_key character varying(191) NOT NULL,
    reserved_value bigint NOT NULL,
    would_reject boolean DEFAULT false NOT NULL,
    status character varying(16) NOT NULL,
    state_version bigint DEFAULT '1'::bigint NOT NULL,
    pending_cleanup_count bigint DEFAULT '0'::bigint NOT NULL,
    target_type character varying(32) NOT NULL,
    target_id character varying(64) NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: resource_usage_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_usage_counters (
    scope_type character varying(16) NOT NULL,
    scope_id character varying(64) NOT NULL,
    resource_type character varying(64) NOT NULL,
    used_value bigint DEFAULT '0'::bigint NOT NULL,
    reserved_value bigint DEFAULT '0'::bigint NOT NULL,
    revision bigint DEFAULT '0'::bigint NOT NULL,
    report_dirty boolean DEFAULT false NOT NULL,
    last_reported_value bigint DEFAULT '0'::bigint NOT NULL,
    last_reported_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    report_lease_token character varying(64) DEFAULT NULL::character varying,
    report_lease_until timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    updated_at timestamp(3) with time zone NOT NULL
);


--
-- Name: resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resources (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    owner_type smallint NOT NULL,
    owner_id character(36) NOT NULL,
    type smallint NOT NULL,
    name character varying(128) NOT NULL,
    description character varying(800) DEFAULT ''::character varying NOT NULL,
    primary_resource_asset_id character(36) DEFAULT NULL::bpchar,
    revision bigint NOT NULL,
    resource_asset_count integer DEFAULT 0 NOT NULL,
    created_by character varying(64) NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    deleted_at bigint
);


--
-- Name: scope_deletion_fences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scope_deletion_fences (
    id character varying(64) NOT NULL,
    tenant_id character varying(255) NOT NULL,
    workspace_id character varying(255),
    closed_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone NOT NULL
);


--
-- Name: task_run_aigw_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_run_aigw_calls (
    task_run_id character(36) NOT NULL,
    call_ordinal integer NOT NULL,
    call_type character varying(64) NOT NULL,
    project_id character(36) NOT NULL,
    model_id character varying(128) NOT NULL,
    model_name character varying(255) NOT NULL,
    model_source character varying(128) NOT NULL,
    request_started_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    request_id character varying(191) DEFAULT NULL::character varying,
    capture_result character varying(32) DEFAULT NULL::character varying,
    billing_status character varying(32) NOT NULL,
    settlement_reason character varying(32) DEFAULT NULL::character varying,
    amount numeric(38,18) DEFAULT NULL::numeric,
    currency character varying(16) DEFAULT NULL::character varying,
    review_reason text NOT NULL,
    state_version bigint NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    finalized_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone
);


--
-- Name: task_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_runs (
    id character(36) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    created_by character varying(64) NOT NULL,
    run_type character varying(64) NOT NULL,
    subject_type character varying(64) NOT NULL,
    subject_id character varying(64) NOT NULL,
    is_internal boolean DEFAULT false NOT NULL,
    hidden_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    status character varying(32) NOT NULL,
    error_code character varying(128) NOT NULL,
    error_message text NOT NULL,
    state_version bigint NOT NULL,
    started_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    finished_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    root_task_id character(36) DEFAULT NULL::bpchar,
    parent_task_id character(36) DEFAULT NULL::bpchar
);


--
-- Name: tenant_storage_usage_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_storage_usage_ledger (
    object_type character varying(32) NOT NULL,
    object_key character varying(191) NOT NULL,
    tenant_id character varying(64) NOT NULL,
    workspace_id character varying(64) DEFAULT NULL::character varying,
    category character varying(32) NOT NULL,
    owner_type character varying(32) NOT NULL,
    owner_id character varying(64) NOT NULL,
    size_bytes bigint NOT NULL,
    billing_class character varying(16) NOT NULL,
    status character varying(16) NOT NULL,
    created_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
    released_at timestamp(3) with time zone DEFAULT NULL::timestamp with time zone
);


--
-- Name: asset_gc_candidates asset_gc_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_gc_candidates
    ADD CONSTRAINT asset_gc_candidates_pkey PRIMARY KEY (asset_id);


--
-- Name: asset_references asset_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_references
    ADD CONSTRAINT asset_references_pkey PRIMARY KEY (asset_id, owner_type, owner_key);


--
-- Name: asset_review_cleanup_outbox asset_review_cleanup_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_review_cleanup_outbox
    ADD CONSTRAINT asset_review_cleanup_outbox_pkey PRIMARY KEY (review_id);


--
-- Name: asset_reviews asset_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_reviews
    ADD CONSTRAINT asset_reviews_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: async_dispatches async_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.async_dispatches
    ADD CONSTRAINT async_dispatches_pkey PRIMARY KEY (task_run_id);


--
-- Name: async_execution_events async_execution_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.async_execution_events
    ADD CONSTRAINT async_execution_events_pkey PRIMARY KEY (id);


--
-- Name: canvas_node_generations canvas_node_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_node_generations
    ADD CONSTRAINT canvas_node_generations_pkey PRIMARY KEY (task_run_id);


--
-- Name: canvas_nodes canvas_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_nodes
    ADD CONSTRAINT canvas_nodes_pkey PRIMARY KEY (id);


--
-- Name: canvas_storyboard_drafts canvas_storyboard_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_storyboard_drafts
    ADD CONSTRAINT canvas_storyboard_drafts_pkey PRIMARY KEY (task_run_id);


--
-- Name: canvas_video_archive_export_inputs canvas_video_archive_export_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_video_archive_export_inputs
    ADD CONSTRAINT canvas_video_archive_export_inputs_pkey PRIMARY KEY (task_run_id);


--
-- Name: canvas_video_archive_exports canvas_video_archive_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_video_archive_exports
    ADD CONSTRAINT canvas_video_archive_exports_pkey PRIMARY KEY (task_run_id);

ALTER TABLE ONLY public.canvas_archive_workflows
    ADD CONSTRAINT canvas_archive_workflows_pkey PRIMARY KEY (task_run_id);


--
-- Name: canvases canvases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvases
    ADD CONSTRAINT canvases_pkey PRIMARY KEY (id);


--
-- Name: deletion_jobs deletion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_jobs
    ADD CONSTRAINT deletion_jobs_pkey PRIMARY KEY (id);


--
-- Name: asset_reviews idx_asset_reviews_task_run_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_reviews
    ADD CONSTRAINT idx_asset_reviews_task_run_id UNIQUE (task_run_id);


--
-- Name: async_execution_events idx_async_execution_events_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.async_execution_events
    ADD CONSTRAINT idx_async_execution_events_sequence UNIQUE (execution_token, sequence);


--
-- Name: async_execution_events idx_async_execution_events_terminal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.async_execution_events
    ADD CONSTRAINT idx_async_execution_events_terminal UNIQUE (execution_token, terminal_slot);


--
-- Name: canvas_node_generations idx_canvas_node_generations_first_last_frame_task_run_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_node_generations
    ADD CONSTRAINT idx_canvas_node_generations_first_last_frame_task_run_id UNIQUE (first_last_frame_task_run_id);


--
-- Name: resource_asset_image_generation_drafts idx_resource_asset_image_generation_drafts_active_task_run_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_drafts
    ADD CONSTRAINT idx_resource_asset_image_generation_drafts_active_task_run_id UNIQUE (active_task_run_id);


--
-- Name: resource_asset_image_generation_drafts idx_resource_asset_image_generation_drafts_resource_asset_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_drafts
    ADD CONSTRAINT idx_resource_asset_image_generation_drafts_resource_asset_id UNIQUE (resource_asset_id);


--
-- Name: resource_assets idx_resource_assets_image_generation_draft_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_assets
    ADD CONSTRAINT idx_resource_assets_image_generation_draft_id UNIQUE (image_generation_draft_id);


--
-- Name: resource_quota_reservations idx_resource_quota_reservations_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_quota_reservations
    ADD CONSTRAINT idx_resource_quota_reservations_idempotency_key UNIQUE (idempotency_key);


--
-- Name: task_run_aigw_calls idx_task_run_aigw_calls_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_run_aigw_calls
    ADD CONSTRAINT idx_task_run_aigw_calls_request UNIQUE (request_id);


--
-- Name: image_generation_run_inputs image_generation_run_inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generation_run_inputs
    ADD CONSTRAINT image_generation_run_inputs_pkey PRIMARY KEY (id);


--
-- Name: image_generation_runs image_generation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generation_runs
    ADD CONSTRAINT image_generation_runs_pkey PRIMARY KEY (task_run_id);


--
-- Name: official_asset_blobs official_asset_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_asset_blobs
    ADD CONSTRAINT official_asset_blobs_pkey PRIMARY KEY (id);


--
-- Name: official_assets official_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_assets
    ADD CONSTRAINT official_assets_pkey PRIMARY KEY (id);


--
-- Name: poll_schedules poll_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poll_schedules
    ADD CONSTRAINT poll_schedules_pkey PRIMARY KEY (task_run_id);


--
-- Name: preset_skills preset_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_skills
    ADD CONSTRAINT preset_skills_pkey PRIMARY KEY (skill_key);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);


--
-- Name: project_resource_rel project_resource_rel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resource_rel
    ADD CONSTRAINT project_resource_rel_pkey PRIMARY KEY (id);


--
-- Name: project_usage_records project_usage_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_usage_records
    ADD CONSTRAINT project_usage_records_pkey PRIMARY KEY (task_run_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: resource_asset_image_generation_drafts resource_asset_image_generation_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_drafts
    ADD CONSTRAINT resource_asset_image_generation_drafts_pkey PRIMARY KEY (id);


--
-- Name: resource_asset_image_generation_resource_references resource_asset_image_generation_resource_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_resource_references
    ADD CONSTRAINT resource_asset_image_generation_resource_references_pkey PRIMARY KEY (id);


--
-- Name: resource_asset_image_generation_uploaded_references resource_asset_image_generation_uploaded_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_uploaded_references
    ADD CONSTRAINT resource_asset_image_generation_uploaded_references_pkey PRIMARY KEY (id);


--
-- Name: resource_asset_revisions resource_asset_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_revisions
    ADD CONSTRAINT resource_asset_revisions_pkey PRIMARY KEY (id);


--
-- Name: resource_assets resource_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_assets
    ADD CONSTRAINT resource_assets_pkey PRIMARY KEY (id);


--
-- Name: resource_quota_reservations resource_quota_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_quota_reservations
    ADD CONSTRAINT resource_quota_reservations_pkey PRIMARY KEY (id);


--
-- Name: resource_usage_counters resource_usage_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_usage_counters
    ADD CONSTRAINT resource_usage_counters_pkey PRIMARY KEY (scope_type, scope_id, resource_type);


--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);


--
-- Name: scope_deletion_fences scope_deletion_fences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scope_deletion_fences
    ADD CONSTRAINT scope_deletion_fences_pkey PRIMARY KEY (id);


--
-- Name: task_run_aigw_calls task_run_aigw_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_run_aigw_calls
    ADD CONSTRAINT task_run_aigw_calls_pkey PRIMARY KEY (task_run_id, call_ordinal);


--
-- Name: task_runs task_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_runs
    ADD CONSTRAINT task_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.canvas_text_generations
    ADD CONSTRAINT canvas_text_generations_pkey PRIMARY KEY (task_run_id);


--
-- Name: tenant_storage_usage_ledger tenant_storage_usage_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_storage_usage_ledger
    ADD CONSTRAINT tenant_storage_usage_ledger_pkey PRIMARY KEY (object_type, object_key);


--
-- Name: assets uniq_assets_owner_creation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT uniq_assets_owner_creation UNIQUE (owner_type, owner_id, creation_key);


--
-- Name: canvases uniq_canvases_project_name_deleted_at; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvases
    ADD CONSTRAINT uniq_canvases_project_name_deleted_at UNIQUE (project_id, name, deleted_at);


--
-- Name: canvas_node_generations uniq_canvasnode_video_generation_provider_task; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canvas_node_generations
    ADD CONSTRAINT uniq_canvasnode_video_generation_provider_task UNIQUE (provider_task_id);


--
-- Name: image_generation_run_inputs uniq_image_generation_run_input_asset; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generation_run_inputs
    ADD CONSTRAINT uniq_image_generation_run_input_asset UNIQUE (task_run_id, asset_id);


--
-- Name: image_generation_run_inputs uniq_image_generation_run_input_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generation_run_inputs
    ADD CONSTRAINT uniq_image_generation_run_input_position UNIQUE (task_run_id, "position");


--
-- Name: official_asset_blobs uniq_official_asset_blobs_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_asset_blobs
    ADD CONSTRAINT uniq_official_asset_blobs_version UNIQUE (slug, file_sha256);


--
-- Name: official_assets uniq_official_assets_internal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_assets
    ADD CONSTRAINT uniq_official_assets_internal UNIQUE (tenant_id, workspace_key, internal_asset_id);


--
-- Name: official_assets uniq_official_assets_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.official_assets
    ADD CONSTRAINT uniq_official_assets_scope UNIQUE (slug, tenant_id, workspace_key, deleted_at);


--
-- Name: project_resource_rel uniq_project_resource_rel_active; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resource_rel
    ADD CONSTRAINT uniq_project_resource_rel_active UNIQUE (project_id, resource_id, deleted_at);


--
-- Name: projects uniq_projects_tenant_name_deleted_at; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uniq_projects_tenant_name_deleted_at UNIQUE (tenant_id, name, deleted_at);


--
-- Name: resource_asset_image_generation_resource_references uniq_raig_resource_pos; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_resource_references
    ADD CONSTRAINT uniq_raig_resource_pos UNIQUE (draft_id, "position");


--
-- Name: resource_asset_image_generation_resource_references uniq_raig_resource_slot; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_resource_references
    ADD CONSTRAINT uniq_raig_resource_slot UNIQUE (draft_id, resource_id, sequence_no);


--
-- Name: resource_asset_image_generation_uploaded_references uniq_raig_upload_asset; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_uploaded_references
    ADD CONSTRAINT uniq_raig_upload_asset UNIQUE (draft_id, asset_id);


--
-- Name: resource_asset_image_generation_uploaded_references uniq_raig_upload_pos; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_image_generation_uploaded_references
    ADD CONSTRAINT uniq_raig_upload_pos UNIQUE (draft_id, "position");


--
-- Name: resource_assets uniq_resource_asset_name_active; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_assets
    ADD CONSTRAINT uniq_resource_asset_name_active UNIQUE (resource_id, name, deleted_at);


--
-- Name: resource_asset_revisions uniq_resource_asset_revisions_asset; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_revisions
    ADD CONSTRAINT uniq_resource_asset_revisions_asset UNIQUE (resource_asset_id, asset_id);


--
-- Name: resource_asset_revisions uniq_resource_asset_revisions_no; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_asset_revisions
    ADD CONSTRAINT uniq_resource_asset_revisions_no UNIQUE (resource_asset_id, revision_no);


--
-- Name: resource_assets uniq_resource_asset_sequence; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_assets
    ADD CONSTRAINT uniq_resource_asset_sequence UNIQUE (resource_id, sequence_no);


--
-- Name: resources uniq_resources_owner_name_deleted_at; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT uniq_resources_owner_name_deleted_at UNIQUE (owner_type, owner_id, name, deleted_at);


--
-- Name: idx_asset_gc_artifact_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_gc_artifact_order ON public.asset_gc_candidates USING btree (artifact_id, created_at, asset_id);


--
-- Name: idx_asset_gc_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_gc_due ON public.asset_gc_candidates USING btree (next_attempt_at, lease_until);


--
-- Name: idx_asset_references_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_references_owner ON public.asset_references USING btree (owner_type, owner_key, deleted_at, asset_id);


--
-- Name: idx_asset_references_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_references_updated ON public.asset_references USING btree (updated_at, asset_id);


--
-- Name: idx_asset_review_cleanup_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_review_cleanup_due ON public.asset_review_cleanup_outbox USING btree (status, next_attempt_at, lease_until);


--
-- Name: idx_asset_review_cleanup_outbox_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_review_cleanup_outbox_asset_id ON public.asset_review_cleanup_outbox USING btree (asset_id);


--
--
-- Name: idx_asset_reviews_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_reviews_scope ON public.asset_reviews USING btree (tenant_id, workspace_id, project_id, asset_id);


--
-- Name: idx_asset_reviews_reservation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_reviews_reservation_id ON public.asset_reviews USING btree (reservation_id);


--
-- Name: idx_assets_artifact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_artifact ON public.assets USING btree (artifact_id);


--
-- Name: idx_assets_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_created_at ON public.assets USING btree (created_at);


--
-- Name: idx_assets_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_creator ON public.assets USING btree (created_by);


--
-- Name: idx_assets_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_deleted_at ON public.assets USING btree (deleted_at);


--
-- Name: idx_assets_gc_scan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_gc_scan ON public.assets USING btree (reference_count, created_at, id);


--
-- Name: idx_assets_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_owner ON public.assets USING btree (owner_type, owner_id);


--
-- Name: idx_assets_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_scope ON public.assets USING btree (tenant_id, workspace_id);


--
-- Name: idx_async_dispatches_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_dispatches_due ON public.async_dispatches USING btree (delivery_state, next_dispatch_at, task_run_id);


--
-- Name: idx_async_dispatches_execution_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_dispatches_execution_due ON public.async_dispatches USING btree (execution_state, execution_lease_until);


--
-- Name: idx_async_execution_events_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_execution_events_due ON public.async_execution_events USING btree (consume_status, next_consume_at);


--
-- Name: idx_async_execution_events_task_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_async_execution_events_task_run_id ON public.async_execution_events USING btree (task_run_id);


--
-- Name: idx_canvas_nodes_canvas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_canvas ON public.canvas_nodes USING btree (canvas_id);


--
-- Name: idx_canvas_nodes_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_deleted_at ON public.canvas_nodes USING btree (deleted_at);


--
-- Name: idx_canvas_nodes_resource_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_resource_asset_id ON public.canvas_nodes USING btree (resource_asset_id);


--
-- Name: idx_canvas_nodes_resource_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_resource_id ON public.canvas_nodes USING btree (resource_id);


--
-- Name: idx_canvas_nodes_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_scope ON public.canvas_nodes USING btree (tenant_id, workspace_id, project_id);


--
-- Name: idx_canvas_nodes_storyboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_storyboard ON public.canvas_nodes USING btree (canvas_id, storyboard_rank, deleted_at);


--
-- Name: idx_canvas_nodes_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_type ON public.canvas_nodes USING btree (type);


--
-- Name: idx_canvas_nodes_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_nodes_updated_at ON public.canvas_nodes USING btree (updated_at);


--
-- Name: idx_canvas_video_archive_cleanup_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_video_archive_cleanup_due ON public.canvas_video_archive_exports USING btree (cleanup_status, cleanup_next_at);


--
-- Name: idx_canvas_video_archive_exports_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_video_archive_exports_list ON public.canvas_video_archive_exports USING btree (tenant_id, workspace_id, project_id, canvas_id, created_at DESC, task_run_id DESC);


--
-- Name: idx_canvas_video_archive_exports_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_video_archive_exports_scope ON public.canvas_video_archive_exports USING btree (tenant_id, workspace_id, project_id, canvas_id, task_run_id DESC, created_at DESC);


--
-- Name: idx_canvas_video_archive_exports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvas_video_archive_exports_status ON public.canvas_video_archive_exports USING btree (status);

CREATE INDEX idx_canvas_archive_workflows_settled ON public.canvas_archive_workflows USING btree (settled);


--
-- Name: idx_canvases_creator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvases_creator ON public.canvases USING btree (created_by);


--
-- Name: idx_canvases_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvases_deleted_at ON public.canvases USING btree (deleted_at);


--
-- Name: idx_canvases_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvases_scope ON public.canvases USING btree (tenant_id, workspace_id, project_id);


--
-- Name: idx_canvases_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvases_updated_at ON public.canvases USING btree (updated_at);


--
-- Name: idx_canvasnode_video_generations_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canvasnode_video_generations_scope ON public.canvas_node_generations USING btree (tenant_id, workspace_id, project_id, canvas_id, node_id, hidden_at, created_at DESC, task_run_id DESC);


--
-- Name: idx_deletion_jobs_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deletion_jobs_due ON public.deletion_jobs USING btree (completed_at, next_attempt_at);


--
-- Name: idx_deletion_jobs_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deletion_jobs_tenant_id ON public.deletion_jobs USING btree (tenant_id);


--
-- Name: idx_image_generation_run_inputs_task_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_generation_run_inputs_task_run_id ON public.image_generation_run_inputs USING btree (task_run_id);


--
-- Name: idx_image_generation_run_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_generation_run_target ON public.image_generation_runs USING btree (target_type, target_id);


--
-- Name: idx_image_generation_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_generation_runs_created_at ON public.image_generation_runs USING btree (created_at);


--
-- Name: idx_image_generation_runs_invocation_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_generation_runs_invocation_project_id ON public.image_generation_runs USING btree (invocation_project_id);


--
-- Name: idx_image_generation_runs_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_generation_runs_scope ON public.image_generation_runs USING btree (tenant_id, workspace_id);


--
-- Name: idx_official_asset_blobs_lease_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_asset_blobs_lease_expires_at ON public.official_asset_blobs USING btree (lease_expires_at);


--
-- Name: idx_official_asset_blobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_asset_blobs_status ON public.official_asset_blobs USING btree (status);


--
-- Name: idx_official_assets_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_assets_deleted_at ON public.official_assets USING btree (deleted_at);


--
-- Name: idx_official_assets_long_live_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_assets_long_live_status ON public.official_assets USING btree (long_live_status);


--
-- Name: idx_official_assets_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_assets_resource ON public.official_assets USING btree (resource_id);


--
-- Name: idx_official_assets_resource_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_assets_resource_asset_id ON public.official_assets USING btree (resource_asset_id);


--
-- Name: idx_official_assets_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_official_assets_slug ON public.official_assets USING btree (slug);


--
-- Name: idx_poll_schedules_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poll_schedules_due ON public.poll_schedules USING btree (next_poll_at, task_run_id);


--
-- Name: idx_preset_skills_asset_center_skill_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_preset_skills_asset_center_skill_id ON public.preset_skills USING btree (asset_center_skill_id);


--
-- Name: idx_project_members_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_members_project ON public.project_members USING btree (project_id, deleted_at);


--
-- Name: idx_project_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_members_user ON public.project_members USING btree (tenant_id, workspace_id, user_id, deleted_at);


--
-- Name: idx_project_resource_rel_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_resource_rel_deleted_at ON public.project_resource_rel USING btree (deleted_at);


--
-- Name: idx_project_resource_rel_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_resource_rel_project ON public.project_resource_rel USING btree (project_id);


--
-- Name: idx_project_resource_rel_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_resource_rel_resource ON public.project_resource_rel USING btree (resource_id);


--
-- Name: idx_project_usage_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_usage_due ON public.project_usage_records USING btree (billing_status, next_attempt_at);


--
-- Name: idx_project_usage_export; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_usage_export ON public.project_usage_records USING btree (tenant_id, workspace_id, project_id, consumed_at, task_run_id);


--
-- Name: idx_project_usage_name_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_usage_name_due ON public.project_usage_records USING btree (created_by_name_resolved_at, created_at, task_run_id);


--
-- Name: idx_projects_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_deleted_at ON public.projects USING btree (deleted_at);


--
-- Name: idx_projects_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_scope ON public.projects USING btree (tenant_id, workspace_id);


--
-- Name: idx_projects_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_updated_at ON public.projects USING btree (updated_at);


--
-- Name: idx_ra_image_drafts_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ra_image_drafts_scope ON public.resource_asset_image_generation_drafts USING btree (tenant_id, workspace_id, deleted_at);


--
-- Name: idx_resource_asset_image_generation_drafts_resource_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_asset_image_generation_drafts_resource_id ON public.resource_asset_image_generation_drafts USING btree (resource_id);


--
-- Name: idx_resource_asset_image_generation_resource_references_87cbcfd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_asset_image_generation_resource_references_87cbcfd ON public.resource_asset_image_generation_resource_references USING btree (resource_id);


--
-- Name: idx_resource_asset_image_generation_resource_references_draft_i; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_asset_image_generation_resource_references_draft_i ON public.resource_asset_image_generation_resource_references USING btree (draft_id);


--
-- Name: idx_resource_asset_image_generation_uploaded_references_draft_i; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_asset_image_generation_uploaded_references_draft_i ON public.resource_asset_image_generation_uploaded_references USING btree (draft_id);


--
-- Name: idx_resource_asset_revisions_resource_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_asset_revisions_resource_asset ON public.resource_asset_revisions USING btree (resource_asset_id);


--
-- Name: idx_resource_assets_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_assets_created_at ON public.resource_assets USING btree (created_at);


--
-- Name: idx_resource_assets_current_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_assets_current_asset_id ON public.resource_assets USING btree (current_asset_id);


--
-- Name: idx_resource_assets_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_assets_resource ON public.resource_assets USING btree (resource_id, deleted_at);


--
-- Name: idx_resource_quota_reservations_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_quota_reservations_expires_at ON public.resource_quota_reservations USING btree (expires_at);


--
-- Name: idx_resource_quota_reservations_target_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_quota_reservations_target_id ON public.resource_quota_reservations USING btree (target_id);


--
-- Name: idx_resource_quota_reservations_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_quota_reservations_tenant_id ON public.resource_quota_reservations USING btree (tenant_id);


--
-- Name: idx_resource_usage_report; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resource_usage_report ON public.resource_usage_counters USING btree (report_dirty, report_lease_until);


--
-- Name: idx_resources_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_created_at ON public.resources USING btree (created_at);


--
-- Name: idx_resources_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_deleted_at ON public.resources USING btree (deleted_at);


--
-- Name: idx_resources_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_owner ON public.resources USING btree (owner_type, owner_id);


--
-- Name: idx_resources_owner_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_owner_type ON public.resources USING btree (owner_id, type);


--
-- Name: idx_resources_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_scope ON public.resources USING btree (tenant_id, workspace_id);


--
-- Name: idx_resources_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_updated_at ON public.resources USING btree (updated_at);


--
-- Name: idx_storage_ledger_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_ledger_active ON public.tenant_storage_usage_ledger USING btree (tenant_id, billing_class, status);


--
-- Name: idx_storyboard_drafts_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storyboard_drafts_current ON public.canvas_storyboard_drafts USING btree (tenant_id, workspace_id, project_id, canvas_id, created_by, resolved_at, task_run_id DESC);


--
-- Name: idx_task_runs_creator_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_creator_updated ON public.task_runs USING btree (tenant_id, workspace_id, created_by, is_internal, updated_at DESC, id DESC);


--
-- Name: idx_task_runs_parent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_parent_created ON public.task_runs USING btree (tenant_id, workspace_id, parent_task_id, created_at);


--
-- Name: idx_task_runs_root_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_root_created ON public.task_runs USING btree (tenant_id, workspace_id, root_task_id, created_at);


--
-- Name: idx_task_runs_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_runs_subject ON public.task_runs USING btree (tenant_id, workspace_id, run_type, subject_type, subject_id);

CREATE INDEX idx_canvas_text_generation_scope ON public.canvas_text_generations USING btree (tenant_id, workspace_id);
CREATE INDEX idx_canvas_text_generation_node ON public.canvas_text_generations USING btree (node_id, status);
CREATE INDEX idx_canvas_text_generations_project_id ON public.canvas_text_generations USING btree (project_id);
CREATE INDEX idx_canvas_text_generations_canvas_id ON public.canvas_text_generations USING btree (canvas_id);


--
-- Name: idx_tenant_storage_usage_ledger_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_storage_usage_ledger_owner_id ON public.tenant_storage_usage_ledger USING btree (owner_id);


--
-- Name: idx_tenant_storage_usage_ledger_owner_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_storage_usage_ledger_owner_type ON public.tenant_storage_usage_ledger USING btree (owner_type);


--
-- Name: uniq_asset_reviews_scope_asset_package; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_asset_reviews_scope_asset_package ON public.asset_reviews USING btree (tenant_id, workspace_id, asset_id, package_id);


--
-- PostgreSQL database dump complete
--
