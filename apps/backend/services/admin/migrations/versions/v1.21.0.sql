-- Skill text stays inline for precise agent editing. Binary files and imported
-- archives are immutable Asset revisions protected by durable Claims.

ALTER TABLE skills
  ADD COLUMN source_archive_asset_id uuid NULL,
  ADD COLUMN source_archive_revision_id uuid NULL,
  ADD CONSTRAINT ck_skills_source_archive CHECK (
    (source_archive_asset_id IS NULL AND source_archive_revision_id IS NULL)
    OR (source_archive_asset_id IS NOT NULL AND source_archive_revision_id IS NOT NULL)
  );

ALTER TABLE skill_nodes
  ADD COLUMN storage_kind varchar(20) NOT NULL DEFAULT 'inline',
  ADD COLUMN asset_id uuid NULL,
  ADD COLUMN revision_id uuid NULL,
  ADD COLUMN size_bytes bigint NULL,
  ADD COLUMN sha256 varchar(64) NULL,
  ADD CONSTRAINT ck_skill_nodes_storage CHECK (
    (node_type = 'directory' AND storage_kind = 'inline' AND content IS NULL AND asset_id IS NULL AND revision_id IS NULL AND size_bytes IS NULL AND sha256 IS NULL)
    OR (node_type = 'file' AND storage_kind = 'inline' AND content IS NOT NULL AND asset_id IS NULL AND revision_id IS NULL)
    OR (node_type = 'file' AND storage_kind = 'asset' AND content IS NULL AND asset_id IS NOT NULL AND revision_id IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)
  ),
  ADD CONSTRAINT ck_skill_nodes_size CHECK (size_bytes IS NULL OR size_bytes >= 0),
  ADD CONSTRAINT ck_skill_nodes_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE skill_published_nodes
  ADD COLUMN storage_kind varchar(20) NOT NULL DEFAULT 'inline',
  ADD COLUMN asset_id uuid NULL,
  ADD COLUMN revision_id uuid NULL,
  ADD COLUMN size_bytes bigint NULL,
  ADD COLUMN sha256 varchar(64) NULL,
  ADD CONSTRAINT ck_skill_published_nodes_storage CHECK (
    (node_type = 'directory' AND storage_kind = 'inline' AND content IS NULL AND asset_id IS NULL AND revision_id IS NULL AND size_bytes IS NULL AND sha256 IS NULL)
    OR (node_type = 'file' AND storage_kind = 'inline' AND content IS NOT NULL AND asset_id IS NULL AND revision_id IS NULL)
    OR (node_type = 'file' AND storage_kind = 'asset' AND content IS NULL AND asset_id IS NOT NULL AND revision_id IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)
  ),
  ADD CONSTRAINT ck_skill_published_nodes_size CHECK (size_bytes IS NULL OR size_bytes >= 0),
  ADD CONSTRAINT ck_skill_published_nodes_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

CREATE TABLE asset_claim_intents (
  tenant_id varchar(64) NOT NULL,
  workspace_id varchar(64) NOT NULL,
  owner_type varchar(64) NOT NULL,
  owner_id varchar(128) NOT NULL,
  slot varchar(128) NOT NULL,
  asset_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('strong', 'snapshot', 'lease', 'weak')),
  generation bigint NOT NULL CHECK (generation > 0),
  desired_state varchar(20) NOT NULL CHECK (desired_state IN ('active', 'released')),
  delivered_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  lease_until timestamptz NULL,
  state_version bigint NOT NULL DEFAULT 1,
  last_error text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, owner_type, owner_id, slot)
);
CREATE INDEX ix_admin_asset_claim_intents_delivery
  ON asset_claim_intents (next_attempt_at, lease_until, updated_at, owner_id)
  WHERE delivered_at IS NULL;

UPDATE migration SET version = 'v1.21.0', update_time = now() WHERE id = 1;
