CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL PRIMARY KEY,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL
);
INSERT INTO migration (id, version, update_time) VALUES (1, 'v0.0.0', NOW()) ON CONFLICT (id) DO NOTHING;

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  tenant_id varchar(64) NOT NULL,
  workspace_id varchar(64) NOT NULL,
  category varchar(64) NOT NULL,
  current_revision_id uuid,
  state varchar(20) NOT NULL CHECK (state IN ('active', 'candidate', 'deleting', 'deleted', 'quarantined')),
  blocking_claim_count bigint NOT NULL DEFAULT 0 CHECK (blocking_claim_count >= 0),
  candidate_at timestamptz,
  delete_after timestamptz,
  state_version bigint NOT NULL DEFAULT 1,
  deletion_attempts integer NOT NULL DEFAULT 0,
  last_error_code varchar(64),
  created_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX ix_assets_gc_scan ON assets (state, blocking_claim_count, updated_at, id);
CREATE INDEX ix_assets_tenant_workspace ON assets (tenant_id, workspace_id, created_at DESC);

CREATE TABLE blobs (
  id uuid PRIMARY KEY,
  tenant_id varchar(64) NOT NULL,
  sha256 char(64) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  storage_key varchar(512) NOT NULL UNIQUE,
  state varchar(20) NOT NULL CHECK (state IN ('active', 'deleting', 'deleted', 'damaged')),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  deleting_at timestamptz,
  deletion_owner_asset_id uuid,
  state_version bigint NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_blobs_active_content ON blobs (tenant_id, sha256, size_bytes)
  WHERE state = 'active';
CREATE INDEX ix_blobs_deletion_owner ON blobs (deletion_owner_asset_id)
  WHERE state = 'deleting';

CREATE TABLE asset_revisions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  blob_id uuid NOT NULL REFERENCES blobs(id),
  revision_number bigint NOT NULL CHECK (revision_number > 0),
  filename varchar(255) NOT NULL,
  media_type varchar(255) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  created_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (asset_id, revision_number)
);
CREATE INDEX ix_asset_revisions_blob ON asset_revisions (blob_id);
ALTER TABLE assets ADD CONSTRAINT fk_assets_current_revision
  FOREIGN KEY (current_revision_id) REFERENCES asset_revisions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE blobs ADD CONSTRAINT fk_blobs_deletion_owner
  FOREIGN KEY (deletion_owner_asset_id) REFERENCES assets(id);

CREATE TABLE asset_claims (
  id uuid PRIMARY KEY,
  tenant_id varchar(64) NOT NULL,
  workspace_id varchar(64) NOT NULL,
  owner_service varchar(32) NOT NULL,
  owner_type varchar(64) NOT NULL,
  owner_id varchar(128) NOT NULL,
  slot varchar(128) NOT NULL,
  asset_id uuid NOT NULL REFERENCES assets(id),
  revision_id uuid REFERENCES asset_revisions(id),
  kind varchar(20) NOT NULL CHECK (kind IN ('strong', 'snapshot', 'lease', 'weak')),
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'active', 'released')),
  generation bigint NOT NULL CHECK (generation > 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  released_at timestamptz,
  UNIQUE (tenant_id, workspace_id, owner_service, owner_type, owner_id, slot)
);
CREATE INDEX ix_asset_claims_blocking ON asset_claims (asset_id, status, kind);
CREATE INDEX ix_asset_claims_lease_expiry ON asset_claims (expires_at) WHERE kind = 'lease' AND status <> 'released';

CREATE TABLE asset_lineage (
  output_revision_id uuid NOT NULL REFERENCES asset_revisions(id) ON DELETE CASCADE,
  input_revision_id uuid NOT NULL REFERENCES asset_revisions(id),
  relation varchar(64) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (output_revision_id, input_revision_id, relation),
  CHECK (output_revision_id <> input_revision_id)
);

CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY,
  tenant_id varchar(64) NOT NULL,
  workspace_id varchar(64) NOT NULL,
  user_id varchar(64) NOT NULL,
  caller_service varchar(64) NOT NULL,
  idempotency_key varchar(255),
  category varchar(64) NOT NULL,
  filename varchar(255) NOT NULL,
  declared_media_type varchar(255) NOT NULL,
  state varchar(20) NOT NULL CHECK (state IN ('uploading', 'completed', 'failed', 'aborted')),
  asset_id uuid REFERENCES assets(id),
  revision_id uuid REFERENCES asset_revisions(id),
  error_code varchar(64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX ix_upload_sessions_expiry ON upload_sessions (state, expires_at);
CREATE UNIQUE INDEX uq_upload_sessions_idempotency
  ON upload_sessions (tenant_id, workspace_id, caller_service, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
