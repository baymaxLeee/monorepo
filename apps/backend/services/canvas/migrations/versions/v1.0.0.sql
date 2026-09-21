CREATE TABLE projects (
 id varchar(36) PRIMARY KEY, tenant_id varchar(26) NOT NULL,
  workspace_id varchar(64) NOT NULL,
 name varchar(100) NOT NULL, description text NOT NULL DEFAULT '', created_by varchar(64) NOT NULL,
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
);
CREATE INDEX projects_workspace ON projects(workspace_id, deleted_at);
CREATE UNIQUE INDEX projects_scope_name ON projects(tenant_id, workspace_id, name) WHERE deleted_at IS NULL;
CREATE TABLE project_members (
 project_id varchar(36) NOT NULL, user_id varchar(64) NOT NULL,
 role varchar(16) NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(project_id,user_id)
);
CREATE TABLE project_model_grants (
 project_id varchar(36) NOT NULL, tenant_id varchar(26) NOT NULL, workspace_id varchar(64) NOT NULL,
 provider_id varchar(160) NOT NULL, PRIMARY KEY(project_id,provider_id)
);
CREATE INDEX project_model_grants_scope ON project_model_grants(tenant_id,workspace_id,project_id);
CREATE TABLE project_usage_policies (
 project_id varchar(36) PRIMARY KEY, tenant_id varchar(26) NOT NULL, workspace_id varchar(64) NOT NULL,
 usage_limit_micros bigint, used_amount_micros bigint NOT NULL DEFAULT 0,
 reserved_amount_micros bigint NOT NULL DEFAULT 0, currency varchar(16) NOT NULL DEFAULT 'CNY',
 CHECK (usage_limit_micros IS NULL OR usage_limit_micros > 0),
 CHECK (used_amount_micros >= 0), CHECK (reserved_amount_micros >= 0)
);
CREATE TABLE canvases (
 id varchar(36) PRIMARY KEY, project_id varchar(36) NOT NULL, name varchar(100) NOT NULL,
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
);
CREATE INDEX canvases_project ON canvases(project_id, deleted_at);
CREATE TABLE canvas_nodes (
 id varchar(36) PRIMARY KEY, canvas_id varchar(36) NOT NULL, type smallint NOT NULL,
 name varchar(100) NOT NULL, text text NOT NULL DEFAULT '', prompt text NOT NULL DEFAULT '',
 x double precision NOT NULL, y double precision NOT NULL, storyboard_rank bigint NOT NULL DEFAULT 0,
 revision bigint NOT NULL DEFAULT 1, incoming_edges jsonb NOT NULL DEFAULT '[]',
 generation_config jsonb NOT NULL DEFAULT '{"provider_id":"","resolution":"","aspect_ratio":"","duration_seconds":0,"generate_audio":false,"watermark":false}'::jsonb,
 video_input_mode smallint NOT NULL DEFAULT 1,
 asset_id varchar(32) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
);
CREATE INDEX canvas_nodes_canvas ON canvas_nodes(canvas_id,deleted_at);
CREATE TABLE canvas_operations (
 canvas_id varchar(36) NOT NULL, user_id varchar(64) NOT NULL, operation_id varchar(160) NOT NULL,
 request_hash varchar(64) NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(canvas_id,user_id,operation_id)
);

CREATE TABLE canvas_generations (
 id varchar(32) PRIMARY KEY,
 canvas_id varchar(32) NOT NULL,
 node_id varchar(36) NOT NULL,
 tenant_id varchar(26) NOT NULL,
  workspace_id varchar(32) NOT NULL,
 user_id varchar(32) NOT NULL,
 operation_id varchar(160) NOT NULL,
 node_revision bigint NOT NULL,
 provider_id varchar(32) NOT NULL,
 prompt text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'queued',
 task_id varchar(32) NOT NULL DEFAULT '',
 task_type varchar(40) NOT NULL DEFAULT 'text-generation',
 input_payload jsonb NOT NULL DEFAULT '{}',
 output_asset_id varchar(32) NOT NULL DEFAULT '',
 output_text text NOT NULL DEFAULT '',
 error text NOT NULL DEFAULT '',
 applied boolean NOT NULL DEFAULT false,
 cancel_requested boolean NOT NULL DEFAULT false,
 reserved_amount_micros bigint NOT NULL DEFAULT 0,
 usage_settled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(canvas_id, user_id, operation_id)
);
CREATE INDEX canvas_generations_node ON canvas_generations(canvas_id,node_id,created_at DESC);
CREATE UNIQUE INDEX canvas_generation_active ON canvas_generations(node_id) WHERE status IN ('queued','running');

CREATE TABLE canvas_asset_match_runs (
 id varchar(32) PRIMARY KEY, canvas_id varchar(32) NOT NULL, node_id varchar(36) NOT NULL,
 node_revision bigint NOT NULL, original_prompt text NOT NULL, candidates jsonb NOT NULL DEFAULT '[]',
 applied boolean NOT NULL DEFAULT false, error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_asset_match_runs_node ON canvas_asset_match_runs(canvas_id,node_id,created_at DESC);

CREATE TABLE assets (
 id varchar(32) PRIMARY KEY,
 tenant_id varchar(26) NOT NULL,
  workspace_id varchar(32) NOT NULL,
 project_id varchar(32) NOT NULL,
 object_key varchar(64) NOT NULL,
 mime_type varchar(100) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE TABLE asset_references (
 asset_id varchar(32) NOT NULL,
 owner_type varchar(60) NOT NULL,
 owner_key varchar(60) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 PRIMARY KEY(asset_id,owner_type,owner_key)
);
CREATE INDEX asset_references_owner ON asset_references(owner_type,owner_key,deleted_at);

CREATE TABLE asset_gc_candidates (
 asset_id varchar(32) PRIMARY KEY,
 tenant_id varchar(26) NOT NULL,
 workspace_id varchar(32) NOT NULL,
 project_id varchar(32) NOT NULL,
 object_key varchar(64) NOT NULL,
 purge_not_before timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL,
 lease_until timestamptz,
 state_version bigint NOT NULL DEFAULT 1,
 attempts integer NOT NULL DEFAULT 0,
 last_error varchar(512) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_gc_candidates_due ON asset_gc_candidates(next_attempt_at,lease_until);
CREATE INDEX asset_gc_candidates_object ON asset_gc_candidates(tenant_id,workspace_id,project_id,object_key,created_at);

CREATE TABLE resources (
 id varchar(36) PRIMARY KEY, tenant_id varchar(26) NOT NULL,
  workspace_id varchar(64) NOT NULL, project_id varchar(36) NOT NULL,
 type smallint NOT NULL, name varchar(128) NOT NULL, description varchar(800) NOT NULL DEFAULT '',
 primary_resource_asset_id varchar(36) NOT NULL DEFAULT '', revision bigint NOT NULL DEFAULT 1,
 resource_asset_count integer NOT NULL DEFAULT 0, created_by varchar(64) NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
);
CREATE INDEX resources_project_type ON resources(project_id,type,deleted_at);
CREATE TABLE resource_assets (
 id varchar(36) PRIMARY KEY, resource_id varchar(36) NOT NULL, name varchar(128) NOT NULL,
 sequence_no bigint NOT NULL, source_type smallint NOT NULL, current_asset_id varchar(36) NOT NULL,
 media_type smallint NOT NULL, revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
);
CREATE INDEX resource_assets_resource ON resource_assets(resource_id,deleted_at);
CREATE TABLE resource_asset_revisions (
 resource_asset_id varchar(36) NOT NULL, asset_id varchar(36) NOT NULL, media_type smallint NOT NULL,
 revision_no bigint NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(resource_asset_id,revision_no)
);

CREATE TABLE task_runs (
 "id" uuid NOT NULL,
 "tenant_id" character varying(64) NOT NULL,
 "workspace_id" character varying(64) DEFAULT NULL::character varying,
 "created_by" character varying(64) NOT NULL,
 "run_type" character varying(64) NOT NULL,
 "subject_type" character varying(64) NOT NULL,
 "subject_id" character varying(64) NOT NULL,
 "is_internal" boolean NOT NULL DEFAULT false,
 "hidden_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "status" character varying(32) NOT NULL,
 "error_code" character varying(128) NOT NULL,
 "error_message" text NOT NULL,
 "state_version" bigint NOT NULL,
 "started_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "finished_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "created_at" timestamp(3) with time zone NOT NULL,
 "updated_at" timestamp(3) with time zone NOT NULL,
 PRIMARY KEY ("id")
);

CREATE INDEX idx_task_runs_creator_updated ON task_runs ("tenant_id", "workspace_id", "created_by", "is_internal", "updated_at", "id");

CREATE INDEX idx_task_runs_subject ON task_runs ("tenant_id", "workspace_id", "run_type", "subject_type", "subject_id");

CREATE TABLE canvas_video_archive_exports (
 "task_run_id" uuid NOT NULL,
 "tenant_id" character varying(64) NOT NULL,
 "workspace_id" character varying(64) DEFAULT NULL::character varying,
 "project_id" uuid NOT NULL,
 "canvas_id" uuid NOT NULL,
 "status" character varying(32) NOT NULL,
 "error_code" character varying(128) NOT NULL,
 "error_message" text NOT NULL,
 "input_count" integer NOT NULL,
 "output_filename" character varying(255) NOT NULL,
 "output_path" character varying(512) NOT NULL,
 "output_size" bigint NOT NULL,
 "output_sha256" character varying(64) NOT NULL,
 "upload_id" character varying(255) NOT NULL,
 "part_size" bigint NOT NULL,
 "created_by" character varying(64) NOT NULL,
 "retention_started_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "retention_guaranteed_until" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "cleanup_status" character varying(32) NOT NULL,
 "cleanup_next_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "cleanup_lease_until" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "cleanup_state_version" bigint NOT NULL,
 "cleanup_attempts" integer NOT NULL,
 "cleanup_last_error" text NOT NULL,
 "started_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "finished_at" timestamp(3) with time zone DEFAULT NULL::timestamp with time zone,
 "created_at" timestamp(3) with time zone NOT NULL,
 "updated_at" timestamp(3) with time zone NOT NULL,
 PRIMARY KEY ("task_run_id")
);

CREATE INDEX idx_canvas_video_archive_cleanup_due ON canvas_video_archive_exports ("cleanup_status", "cleanup_next_at");

CREATE INDEX idx_canvas_video_archive_exports_list ON canvas_video_archive_exports ("tenant_id", "workspace_id", "project_id", "canvas_id", "created_at", "task_run_id");

CREATE INDEX idx_canvas_video_archive_exports_scope ON canvas_video_archive_exports ("tenant_id", "workspace_id", "project_id", "canvas_id", "task_run_id", "created_at");

CREATE INDEX idx_canvas_video_archive_exports_status ON canvas_video_archive_exports ("status");

CREATE TABLE canvas_video_archive_export_inputs (
 "task_run_id" uuid NOT NULL,
 "inputs" jsonb NOT NULL,
 "created_at" timestamp(3) with time zone NOT NULL,
 PRIMARY KEY ("task_run_id")
);

CREATE TABLE canvas_workflow_tasks (
 task_run_id uuid PRIMARY KEY,
 executor_task_id varchar(32) NOT NULL DEFAULT '',
 cancel_requested boolean NOT NULL DEFAULT false,
 settled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_workflow_tasks_pending ON canvas_workflow_tasks (created_at) WHERE NOT settled;

CREATE TABLE "resource_asset_image_generation_drafts" (
  "id" uuid NOT NULL,
  "tenant_id" varchar(64) NOT NULL,
  "workspace_id" varchar(64) DEFAULT NULL,
  "resource_id" uuid NOT NULL,
  "resource_asset_id" uuid NOT NULL,
  "prompt" text NOT NULL,
  "model_id" varchar(128) NOT NULL,
  "resolution" varchar(16) NOT NULL,
  "aspect_ratio" varchar(16) NOT NULL,
  "watermark" boolean NOT NULL,
  "revision" bigint NOT NULL,
  "active_task_run_id" uuid DEFAULT NULL,
  "created_by" varchar(64) NOT NULL,
  "created_at" timestamptz(3) NOT NULL,
  "updated_at" timestamptz(3) NOT NULL,
  "deleted_at" bigint DEFAULT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "idx_resource_asset_image_generation_drafts_resource_asset_id" UNIQUE ("resource_asset_id"),
  CONSTRAINT "idx_resource_asset_image_generation_drafts_active_task_run_id" UNIQUE ("active_task_run_id")
);
CREATE INDEX "idx_ra_image_drafts_scope" ON "resource_asset_image_generation_drafts" ("tenant_id","workspace_id","deleted_at");
CREATE INDEX "idx_resource_asset_image_generation_drafts_resource_id" ON "resource_asset_image_generation_drafts" ("resource_id");

CREATE TABLE "resource_asset_image_generation_resource_references" (
  "id" bigint NOT NULL GENERATED BY DEFAULT AS IDENTITY,
  "draft_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "resource_id" uuid NOT NULL,
  "sequence_no" bigint NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uniq_raig_resource_pos" UNIQUE ("draft_id","position"),
  CONSTRAINT "uniq_raig_resource_slot" UNIQUE ("draft_id","resource_id","sequence_no")
);
CREATE INDEX "idx_resource_asset_image_generation_resource_references_draft_id" ON "resource_asset_image_generation_resource_references" ("draft_id");
CREATE INDEX "idx_resource_asset_image_generation_resource_references_87cbcfdd" ON "resource_asset_image_generation_resource_references" ("resource_id");

CREATE TABLE "resource_asset_image_generation_uploaded_references" (
  "id" bigint NOT NULL GENERATED BY DEFAULT AS IDENTITY,
  "draft_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "asset_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "uniq_raig_upload_pos" UNIQUE ("draft_id","position"),
  CONSTRAINT "uniq_raig_upload_asset" UNIQUE ("draft_id","asset_id")
);
CREATE INDEX "idx_resource_asset_image_generation_uploaded_references_draft_id" ON "resource_asset_image_generation_uploaded_references" ("draft_id");
CREATE INDEX "idx_resource_asset_image_generation_uploaded_references_asset_id" ON "resource_asset_image_generation_uploaded_references" ("asset_id");

CREATE TABLE resource_image_runs (
 project_id varchar(36) NOT NULL, resource_id varchar(36) NOT NULL, resource_asset_id varchar(36) NOT NULL,
 id varchar(32) PRIMARY KEY,
 canvas_id varchar(32) NOT NULL,
 node_id varchar(36) NOT NULL,
 tenant_id varchar(26) NOT NULL,
  workspace_id varchar(32) NOT NULL,
 user_id varchar(32) NOT NULL,
 operation_id varchar(160) NOT NULL,
 node_revision bigint NOT NULL,
 provider_id varchar(32) NOT NULL,
 prompt text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'queued',
 task_id varchar(32) NOT NULL DEFAULT '',
 task_type varchar(40) NOT NULL DEFAULT 'text-generation',
 input_payload jsonb NOT NULL DEFAULT '{}',
 output_asset_id varchar(32) NOT NULL DEFAULT '',
 output_text text NOT NULL DEFAULT '',
 error text NOT NULL DEFAULT '',
 applied boolean NOT NULL DEFAULT false,
 cancel_requested boolean NOT NULL DEFAULT false,
 reserved_amount_micros bigint NOT NULL DEFAULT 0,
 usage_settled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(resource_asset_id, user_id, operation_id)
);
CREATE UNIQUE INDEX resource_image_run_active ON resource_image_runs(resource_asset_id) WHERE status IN ('queued','running');
CREATE INDEX resource_image_runs_history ON resource_image_runs(resource_asset_id, created_at DESC);

CREATE TABLE canvas_storyboard_sessions (
 id varchar(36) PRIMARY KEY,
 canvas_id varchar(36) NOT NULL,
 tenant_id text NOT NULL,
 workspace_id text NOT NULL,
 user_id text NOT NULL,
 operation_id text NOT NULL,
 request_hash text NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 input jsonb NOT NULL,
 shots jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL,
 error text NOT NULL DEFAULT '',
 task_id text NOT NULL DEFAULT '',
 cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (canvas_id, user_id, operation_id)
);
CREATE INDEX canvas_storyboard_sessions_active ON canvas_storyboard_sessions(status) WHERE status IN ('queued','running');
CREATE INDEX canvas_storyboard_sessions_scope ON canvas_storyboard_sessions(tenant_id,workspace_id,canvas_id,user_id,created_at DESC);

-- Usage settlement is tied to the durable generation state transition so all
-- workers (including newly migrated generation flows) share one atomic rule.
CREATE FUNCTION settle_canvas_generation_usage() RETURNS trigger AS $$
DECLARE
  target_project_id varchar(36);
BEGIN
  IF NEW.usage_settled OR NEW.status NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'canvas_generations' THEN
    SELECT project_id INTO target_project_id FROM canvases WHERE id = NEW.canvas_id;
  ELSE
    target_project_id := NEW.project_id;
  END IF;
  IF NEW.reserved_amount_micros > 0 THEN
    UPDATE project_usage_policies
      SET reserved_amount_micros = GREATEST(reserved_amount_micros - NEW.reserved_amount_micros, 0),
          used_amount_micros = used_amount_micros + CASE WHEN NEW.status = 'completed' THEN NEW.reserved_amount_micros ELSE 0 END
      WHERE project_id = target_project_id;
  END IF;
  NEW.usage_settled := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER canvas_generation_usage_settlement BEFORE UPDATE OF status ON canvas_generations
  FOR EACH ROW EXECUTE FUNCTION settle_canvas_generation_usage();
CREATE TRIGGER resource_generation_usage_settlement BEFORE UPDATE OF status ON resource_image_runs
  FOR EACH ROW EXECUTE FUNCTION settle_canvas_generation_usage();
CREATE TABLE canvas_video_frames (
 id varchar(32) PRIMARY KEY,
 generation_id varchar(32) NOT NULL UNIQUE,
 task_id varchar(32) NOT NULL DEFAULT '',
 status varchar(20) NOT NULL DEFAULT 'queued',
 cancel_requested boolean NOT NULL DEFAULT false,
 first_key varchar(64) NOT NULL DEFAULT '', last_key varchar(64) NOT NULL DEFAULT '',
 first_size bigint NOT NULL DEFAULT 0, last_size bigint NOT NULL DEFAULT 0,
 first_asset_id varchar(32) NOT NULL DEFAULT '', last_asset_id varchar(32) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_video_frames_active ON canvas_video_frames(status) WHERE status IN ('queued','running');

CREATE TABLE canvas_views (canvas_id varchar(36) NOT NULL, user_id text NOT NULL, x double precision NOT NULL, y double precision NOT NULL, zoom double precision NOT NULL CHECK(zoom > 0), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(canvas_id,user_id));


CREATE TABLE generation_usage_metadata (
 generation_id varchar(36) PRIMARY KEY,
 tenant_id varchar(26) NOT NULL,
 workspace_id varchar(64) NOT NULL,
 project_id varchar(36) NOT NULL,
 model_name text NOT NULL,
 model_id text NOT NULL,
 currency varchar(16) NOT NULL DEFAULT '',
 estimate_known boolean NOT NULL DEFAULT false
);
CREATE INDEX generation_usage_metadata_scope ON generation_usage_metadata(tenant_id,workspace_id,project_id);

CREATE TABLE asset_reviews (
 id varchar(32) PRIMARY KEY,
 tenant_id varchar(26) NOT NULL, workspace_id varchar(64) NOT NULL, project_id varchar(36) NOT NULL,
 resource_asset_id varchar(36) NOT NULL, asset_id varchar(32) NOT NULL,
 benefit_package_id varchar(32) NOT NULL, package_name varchar(80) NOT NULL, is_preset boolean NOT NULL,
 reservation_id varchar(36) NOT NULL, operation_id varchar(36) NOT NULL, created_by varchar(64) NOT NULL,
 provider_asset_id varchar(128) NOT NULL DEFAULT '',
 submission_started_at timestamptz,
 status varchar(16) NOT NULL CHECK(status IN ('SUBMITTING','PROCESSING','APPROVED','FAILED')),
 failure_reason varchar(512) NOT NULL DEFAULT '', submitted_at timestamptz,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 CONSTRAINT asset_reviews_operation UNIQUE(tenant_id,workspace_id,created_by,operation_id),
 CONSTRAINT asset_reviews_asset_package UNIQUE(tenant_id,workspace_id,project_id,asset_id,benefit_package_id)
);
CREATE INDEX asset_reviews_project_current ON asset_reviews(tenant_id,workspace_id,project_id,resource_asset_id,updated_at DESC);
CREATE INDEX asset_reviews_reservation ON asset_reviews(reservation_id);
CREATE INDEX asset_reviews_pending ON asset_reviews(created_at) WHERE status IN ('SUBMITTING','PROCESSING');
