-- Align the active Canvas compatibility schema with the AgentFrame asset model.
-- Stored values remain unchanged: Knowledge's content-addressed object ID is the
-- immutable artifact ID. This migration performs no byte copy or data rewrite.

ALTER TABLE assets RENAME COLUMN object_key TO artifact_id;
ALTER TABLE asset_gc_candidates RENAME COLUMN object_key TO artifact_id;
ALTER INDEX IF EXISTS asset_gc_candidates_object RENAME TO asset_gc_candidates_artifact;
