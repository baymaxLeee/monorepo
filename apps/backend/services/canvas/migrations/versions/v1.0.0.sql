CREATE TABLE projects (
 id varchar(36) PRIMARY KEY, org_id varchar(64) NOT NULL,
 name varchar(100) NOT NULL, description text NOT NULL DEFAULT '', created_by varchar(64) NOT NULL,
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz
);
CREATE INDEX projects_org ON projects(org_id, deleted_at);
CREATE TABLE project_members (
 project_id varchar(36) NOT NULL, user_id varchar(64) NOT NULL,
 role varchar(16) NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(project_id,user_id)
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
 org_id varchar(32) NOT NULL,
 user_id varchar(32) NOT NULL,
 operation_id varchar(160) NOT NULL,
 node_revision bigint NOT NULL,
 provider_id varchar(32) NOT NULL,
 prompt text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'queued',
 task_id varchar(32) NOT NULL DEFAULT '',
 output_text text NOT NULL DEFAULT '',
 error text NOT NULL DEFAULT '',
 applied boolean NOT NULL DEFAULT false,
 cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(canvas_id, user_id, operation_id)
);
CREATE INDEX canvas_generations_node ON canvas_generations(canvas_id,node_id,created_at DESC);
CREATE UNIQUE INDEX canvas_generation_active ON canvas_generations(node_id) WHERE status IN ('queued','running');

CREATE TABLE assets (
 id varchar(32) PRIMARY KEY,
 org_id varchar(32) NOT NULL,
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

CREATE TABLE resources (
 id varchar(36) PRIMARY KEY, org_id varchar(64) NOT NULL, project_id varchar(36) NOT NULL,
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
