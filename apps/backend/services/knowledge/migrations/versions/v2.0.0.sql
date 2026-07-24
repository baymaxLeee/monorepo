DROP TABLE IF EXISTS artifact_revision_blocks;
DROP TABLE IF EXISTS artifact_revisions;
DROP TABLE IF EXISTS artifact_block_versions;
DROP TABLE IF EXISTS artifact_generation_blocks;
DROP TABLE IF EXISTS artifact_generations;
ALTER TABLE documents DROP COLUMN IF EXISTS current_revision_id;

CREATE TABLE file_entries (
  id varchar(32) PRIMARY KEY,
  user_id varchar(26) NOT NULL,
  org_id varchar(26) NOT NULL,
  conversation_id varchar(32) NOT NULL,
  path varchar(512) NOT NULL,
  mime_type varchar(120) NOT NULL,
  content text NOT NULL,
  sha256 varchar(64) NOT NULL,
  writable boolean NOT NULL DEFAULT true,
  derived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT ux_file_entry_root_path UNIQUE (user_id, conversation_id, path)
);
CREATE INDEX ix_file_entries_conversation ON file_entries (user_id, conversation_id);

CREATE TABLE file_change_sets (
  id varchar(32) PRIMARY KEY,
  user_id varchar(26) NOT NULL,
  org_id varchar(26) NOT NULL,
  conversation_id varchar(32) NOT NULL,
  status varchar(24) NOT NULL,
  baseline_sha256 jsonb NOT NULL,
  metadata_json jsonb NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX ix_file_change_sets_root ON file_change_sets (user_id, conversation_id, status);

CREATE TABLE file_change_set_entries (
  id varchar(32) PRIMARY KEY,
  change_set_id varchar(32) NOT NULL,
  path varchar(512) NOT NULL,
  mime_type varchar(120) NOT NULL,
  content text NOT NULL,
  sha256 varchar(64) NOT NULL,
  writable boolean NOT NULL DEFAULT true,
  derived boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT ux_file_change_set_path UNIQUE (change_set_id, path)
);
CREATE INDEX ix_file_change_set_entries_change_set ON file_change_set_entries (change_set_id);
