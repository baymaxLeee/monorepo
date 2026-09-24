-- Generated and staged media now reference immutable Asset revisions. The old
-- object columns are removed after all media producers have switched.

ALTER TABLE staged_media
  ADD COLUMN asset_id uuid NULL,
  ADD COLUMN revision_id uuid NULL,
  ADD COLUMN asset_sha256 varchar(64) NULL;

CREATE INDEX ix_staged_media_asset_revision
  ON staged_media (asset_id, revision_id)
  WHERE asset_id IS NOT NULL;

UPDATE migration SET version = 'v2.4.0', update_time = now() WHERE id = 1;
