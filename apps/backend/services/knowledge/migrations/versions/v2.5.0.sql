-- Asset owns all source and generated-media bytes. Knowledge retains only the
-- immutable Asset identity and domain-specific document metadata.

ALTER TABLE documents
  DROP COLUMN object_bucket,
  DROP COLUMN object_key,
  DROP COLUMN object_sha256;

ALTER TABLE staged_media
  ALTER COLUMN asset_id SET NOT NULL,
  ALTER COLUMN revision_id SET NOT NULL,
  ALTER COLUMN asset_sha256 SET NOT NULL,
  DROP COLUMN object_bucket,
  DROP COLUMN object_key,
  DROP COLUMN object_sha256;

UPDATE migration SET version = 'v2.5.0', update_time = now() WHERE id = 1;
