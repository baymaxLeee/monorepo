ALTER TABLE artifact_generations
  ADD COLUMN base_revision_id varchar(32) NULL;

ALTER TABLE documents
  ADD COLUMN current_revision_id varchar(32) NULL;

ALTER TABLE artifact_block_versions RENAME TO artifact_generation_blocks;
ALTER TABLE artifact_generation_blocks
  RENAME CONSTRAINT artifact_block_versions_pkey TO artifact_generation_blocks_pkey;
ALTER TABLE artifact_generation_blocks
  RENAME CONSTRAINT ux_artifact_block_generation_id TO ux_artifact_generation_block_id;
ALTER INDEX ix_artifact_blocks_generation_id RENAME TO ix_artifact_generation_blocks_generation_id;

ALTER TABLE artifact_generation_blocks
  ADD COLUMN version_id varchar(32) NULL;

CREATE TABLE artifact_block_versions (
  id varchar(32) PRIMARY KEY,
  document_id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  block_id varchar(80) NOT NULL,
  block_type varchar(40) NOT NULL,
  object_bucket varchar(64) NOT NULL,
  object_key varchar(512) NOT NULL,
  object_sha256 varchar(64) NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ux_artifact_block_content UNIQUE (document_id, block_id, object_sha256)
);

CREATE INDEX ix_artifact_block_versions_document_id
  ON artifact_block_versions (document_id);

INSERT INTO artifact_block_versions (
  id,
  document_id,
  user_id,
  block_id,
  block_type,
  object_bucket,
  object_key,
  object_sha256,
  created_at
)
SELECT DISTINCT ON (ag.document_id, agb.block_id, agb.object_sha256)
  agb.id,
  ag.document_id,
  ag.user_id,
  agb.block_id,
  agb.block_type,
  agb.object_bucket,
  agb.object_key,
  agb.object_sha256,
  agb.created_at
FROM artifact_generation_blocks agb
JOIN artifact_generations ag ON ag.id = agb.generation_id
WHERE agb.status = 'ready'
  AND agb.object_bucket IS NOT NULL
  AND agb.object_key IS NOT NULL
  AND agb.object_sha256 IS NOT NULL
ORDER BY ag.document_id, agb.block_id, agb.object_sha256, agb.created_at, agb.id;

UPDATE artifact_generation_blocks agb
SET version_id = abv.id
FROM artifact_generations ag, artifact_block_versions abv
WHERE ag.id = agb.generation_id
  AND abv.document_id = ag.document_id
  AND abv.block_id = agb.block_id
  AND abv.object_sha256 = agb.object_sha256;

ALTER TABLE artifact_generation_blocks
  DROP COLUMN object_bucket,
  DROP COLUMN object_key,
  DROP COLUMN object_sha256;

CREATE INDEX ix_artifact_generation_blocks_version_id
  ON artifact_generation_blocks (version_id);

CREATE TABLE artifact_revisions (
  id varchar(32) PRIMARY KEY,
  document_id varchar(32) NOT NULL,
  parent_revision_id varchar(32) NULL,
  generation_id varchar(32) NOT NULL,
  manifest_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ux_artifact_revision_generation UNIQUE (generation_id)
);

CREATE INDEX ix_artifact_revisions_document_id
  ON artifact_revisions (document_id, created_at);

WITH completed AS (
  SELECT
    ag.id AS generation_id,
    ag.document_id,
    ag.manifest_json,
    COALESCE(ag.finished_at, ag.updated_at) AS revision_at,
    md5('artifact-revision:' || ag.id) AS revision_id,
    lag(md5('artifact-revision:' || ag.id)) OVER (
      PARTITION BY ag.document_id
      ORDER BY COALESCE(ag.finished_at, ag.updated_at), ag.id
    ) AS parent_revision_id
  FROM artifact_generations ag
  WHERE ag.status = 'completed'
)
INSERT INTO artifact_revisions (
  id,
  document_id,
  parent_revision_id,
  generation_id,
  manifest_json,
  created_at
)
SELECT
  revision_id,
  document_id,
  parent_revision_id,
  generation_id,
  COALESCE(manifest_json, '{}'::jsonb),
  revision_at
FROM completed;

CREATE TABLE artifact_revision_blocks (
  revision_id varchar(32) NOT NULL,
  block_id varchar(80) NOT NULL,
  version_id varchar(32) NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (revision_id, block_id)
);

CREATE INDEX ix_artifact_revision_blocks_version_id
  ON artifact_revision_blocks (version_id);

INSERT INTO artifact_revision_blocks (revision_id, block_id, version_id, position)
SELECT ar.id, agb.block_id, agb.version_id, agb.position
FROM artifact_revisions ar
JOIN artifact_generation_blocks agb ON agb.generation_id = ar.generation_id
WHERE agb.status = 'ready' AND agb.version_id IS NOT NULL;

WITH revision_chain AS (
  SELECT
    ar.generation_id,
    ar.parent_revision_id
  FROM artifact_revisions ar
)
UPDATE artifact_generations ag
SET base_revision_id = revision_chain.parent_revision_id
FROM revision_chain
WHERE revision_chain.generation_id = ag.id;

WITH heads AS (
  SELECT DISTINCT ON (ar.document_id)
    ar.document_id,
    ar.id AS revision_id
  FROM artifact_revisions ar
  ORDER BY ar.document_id, ar.created_at DESC, ar.id DESC
)
UPDATE documents d
SET current_revision_id = heads.revision_id
FROM heads
WHERE heads.document_id = d.id;

UPDATE migration SET version = 'v1.9.0', update_time = NOW() WHERE id = 1;
