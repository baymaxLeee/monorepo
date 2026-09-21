ALTER TABLE projects ADD COLUMN cover_asset_id varchar(32) NOT NULL DEFAULT '';
CREATE INDEX projects_cover_asset ON projects(cover_asset_id) WHERE cover_asset_id <> '';

ALTER TABLE canvases ADD COLUMN cover_asset_id varchar(32) NOT NULL DEFAULT '';
ALTER TABLE canvases ADD COLUMN created_by varchar(64) NOT NULL DEFAULT '';
ALTER TABLE canvases ADD COLUMN default_view smallint NOT NULL DEFAULT 2 CHECK(default_view IN (1,2));
UPDATE canvases
SET created_by = projects.created_by
FROM projects
WHERE canvases.project_id = projects.id AND canvases.created_by = '';
CREATE INDEX canvases_cover_asset ON canvases(cover_asset_id) WHERE cover_asset_id <> '';
CREATE INDEX canvases_project_creator ON canvases(project_id,created_by,deleted_at);

DROP TABLE IF EXISTS project_model_grants;

CREATE TABLE IF NOT EXISTS project_usage_policies (
 project_id varchar(36) PRIMARY KEY, tenant_id varchar(26) NOT NULL, workspace_id varchar(64) NOT NULL,
 usage_limit_micros bigint, used_amount_micros bigint NOT NULL DEFAULT 0,
 reserved_amount_micros bigint NOT NULL DEFAULT 0, currency varchar(16) NOT NULL DEFAULT 'CNY',
 CHECK (usage_limit_micros IS NULL OR usage_limit_micros > 0),
 CHECK (used_amount_micros >= 0), CHECK (reserved_amount_micros >= 0)
);
INSERT INTO project_usage_policies (project_id,tenant_id,workspace_id,currency)
SELECT id,tenant_id,workspace_id,'CNY' FROM projects
ON CONFLICT (project_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS canvas_asset_match_runs (
 id varchar(32) PRIMARY KEY, canvas_id varchar(32) NOT NULL, node_id varchar(36) NOT NULL,
 node_revision bigint NOT NULL, original_prompt text NOT NULL, candidates jsonb NOT NULL DEFAULT '[]',
 applied boolean NOT NULL DEFAULT false, error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS canvas_asset_match_runs_node ON canvas_asset_match_runs(canvas_id,node_id,created_at DESC);

CREATE TABLE IF NOT EXISTS generation_usage_metadata (
 generation_id varchar(36) PRIMARY KEY,
 tenant_id varchar(26) NOT NULL,
 workspace_id varchar(64) NOT NULL,
 project_id varchar(36) NOT NULL,
 model_name text NOT NULL,
 model_id text NOT NULL,
 currency varchar(16) NOT NULL DEFAULT '',
 estimate_known boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS generation_usage_metadata_scope ON generation_usage_metadata(tenant_id,workspace_id,project_id);

CREATE TABLE IF NOT EXISTS asset_gc_candidates (
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
CREATE INDEX IF NOT EXISTS asset_gc_candidates_due ON asset_gc_candidates(next_attempt_at,lease_until);
CREATE INDEX IF NOT EXISTS asset_gc_candidates_object ON asset_gc_candidates(tenant_id,workspace_id,project_id,object_key,created_at);

CREATE TABLE IF NOT EXISTS canvas_views (
 canvas_id varchar(36) NOT NULL,
 user_id text NOT NULL,
 x double precision NOT NULL,
 y double precision NOT NULL,
 zoom double precision NOT NULL CHECK(zoom > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(canvas_id,user_id)
);

CREATE TABLE IF NOT EXISTS asset_reviews (
 id varchar(32) PRIMARY KEY,
 tenant_id varchar(26) NOT NULL,
 workspace_id varchar(64) NOT NULL,
 project_id varchar(36) NOT NULL,
 resource_asset_id varchar(36) NOT NULL,
 asset_id varchar(32) NOT NULL,
 benefit_package_id varchar(32) NOT NULL,
 package_name varchar(80) NOT NULL,
 is_preset boolean NOT NULL,
 reservation_id varchar(36) NOT NULL,
 operation_id varchar(36) NOT NULL,
 created_by varchar(64) NOT NULL,
 provider_asset_id varchar(128) NOT NULL DEFAULT '',
 submission_started_at timestamptz,
 status varchar(16) NOT NULL CHECK(status IN ('SUBMITTING','PROCESSING','APPROVED','FAILED')),
 failure_reason varchar(512) NOT NULL DEFAULT '',
 submitted_at timestamptz,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 deleted_at timestamptz,
 CONSTRAINT asset_reviews_operation UNIQUE(tenant_id,workspace_id,created_by,operation_id)
);
CREATE INDEX IF NOT EXISTS asset_reviews_project_current ON asset_reviews(tenant_id,workspace_id,project_id,resource_asset_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS asset_reviews_reservation ON asset_reviews(reservation_id);
CREATE INDEX IF NOT EXISTS asset_reviews_pending ON asset_reviews(created_at) WHERE status IN ('SUBMITTING','PROCESSING');
CREATE UNIQUE INDEX IF NOT EXISTS asset_reviews_asset_package_active
 ON asset_reviews(tenant_id,workspace_id,project_id,asset_id,benefit_package_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_review_cleanups (
 id varchar(32) PRIMARY KEY,
 review_id varchar(32) NOT NULL UNIQUE,
 asset_id varchar(32) NOT NULL,
 tenant_id varchar(26) NOT NULL,
 workspace_id varchar(64) NOT NULL,
 benefit_package_id varchar(32) NOT NULL,
 reservation_id varchar(36) NOT NULL,
 provider_asset_id varchar(128) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 next_attempt_at timestamptz NOT NULL,
 lease_until timestamptz,
 lease_token varchar(32) NOT NULL DEFAULT '',
 last_error varchar(512) NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS asset_review_cleanups_due ON asset_review_cleanups(status,next_attempt_at,lease_until);
CREATE INDEX IF NOT EXISTS asset_review_cleanups_package ON asset_review_cleanups(tenant_id,workspace_id,benefit_package_id,status);
CREATE INDEX IF NOT EXISTS asset_review_cleanups_asset ON asset_review_cleanups(tenant_id,workspace_id,asset_id,benefit_package_id,status);

ALTER TABLE assets ADD COLUMN original_name varchar(255) NOT NULL DEFAULT '';
