-- Prune dead columns from the artifact task tables.
--
-- After the "single snapshot, edit-in-place, no versions" refactor (v1.3.0), the
-- executor's Workflow DevKit run is the sole owner of a generation start-to-finish
-- and the served artifact is documents.object_key. That left a batch of columns
-- with writers but no readers:
--   artifact_generations
--     lease_owner/lease_expires_at    old worker-pool lease protocol (no pool exists)
--     kind                            written, never returned or queried
--     attempt                         written as constant 1, never read
--     run_id/tool_call_id             executor never sends them (always NULL)
--     phase                           redundant with status; no branch reads it
--     started_at                      observability only, no functional reader
--   artifact_block_versions
--     document_id                     every lookup goes through generation_id
--     brief                           authoritative copy lives in manifest_json
--     content_size                    never read (publish uses the stored object size)
--     attempt                         written, never read
-- Cancellation stays: the executor task's cancel handler still flips a generation to
-- `cancelled` through knowledge, so `cancel_requested_at` is kept; only the lease/phase/
-- run-tracking columns go, since the single WDK run owns the generation start-to-finish.

DROP INDEX IF EXISTS ix_artifact_generations_run_id;
ALTER TABLE artifact_generations
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS attempt,
  DROP COLUMN IF EXISTS run_id,
  DROP COLUMN IF EXISTS tool_call_id,
  DROP COLUMN IF EXISTS phase,
  DROP COLUMN IF EXISTS started_at;

DROP INDEX IF EXISTS ix_artifact_blocks_document_id;
ALTER TABLE artifact_block_versions
  DROP COLUMN IF EXISTS document_id,
  DROP COLUMN IF EXISTS brief,
  DROP COLUMN IF EXISTS content_size,
  DROP COLUMN IF EXISTS attempt;

UPDATE migration SET version = 'v1.4.0', update_time = NOW() WHERE id = 1;
