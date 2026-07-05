-- Drop artifact version history.
--
-- Product model: one conversation → one topic → exactly one HTML artifact, always
-- edited in place. There is no rollback/restore UX, so per-edit immutable
-- revisions were pure overhead. The served artifact lives on documents.object_key
-- (overwritten in place at publish); the "current" block set is simply the latest
-- completed generation's blocks. Generations remain as the durable background-task
-- record (progress/cancel/idempotency), not as versions.

DROP TABLE IF EXISTS artifact_revisions;
ALTER TABLE artifact_generations DROP COLUMN IF EXISTS base_revision_id;

UPDATE migration SET version = 'v1.3.0', update_time = NOW() WHERE id = 1;
