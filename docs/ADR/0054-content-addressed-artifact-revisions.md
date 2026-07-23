# ADR 0054: Content-addressed artifact revisions

## Status

Accepted.

## Context

HTML artifacts publish one current compiled file through `documents.object_key`, but
the editable block storage historically treated every generation as a complete copy.
`artifact_block_versions` was keyed by `(generation_id, block_id)`, and Executor's
`reuse` branch uploaded the previous JSON into a new generation-specific object key.
One observed 30-block document accumulated 90 rows and 90 objects over three
generations even though only 35 payload hashes were distinct; the last edit copied 29
unchanged blocks.

The table also mixed two different lifecycles: retryable Workflow execution state and
immutable document content. Reading the latest completed generation and publishing
with last-writer-wins allowed an older concurrent edit to become the current document
if it finished later.

Git stores content-addressed blobs and has trees reference them. OCI manifests likewise
reference content-addressed layers by digest. Workflow DevKit persists and retries step
results; it does not require application content to be copied for every workflow run.

## Decision

1. `artifact_generations` remains execution metadata and records the
   `base_revision_id` read before an edit.
2. `artifact_generation_blocks` records per-generation execution state. A ready row
   references an immutable block version; it does not own block bytes.
3. `artifact_block_versions` stores immutable logical versions. Block bytes use a
   deterministic object key derived from the document ID and SHA-256. Saving identical
   content reuses the existing version and physical object.
4. `artifact_revisions` stores immutable document snapshots. Each
   `artifact_revision_blocks` row maps one logical block to one block version. An edit
   creates versions only for changed blocks; unchanged blocks inherit their version IDs.
5. `documents.current_revision_id` is the authoritative head pointer. Workspace reads
   resolve through it rather than ordering generations by completion time.
6. Publish locks the document, verifies `base_revision_id`, validates the actual ready
   generation-block set, creates the revision mapping, replaces the fixed
   `artifacts/<document>/<user>/current.html` object, and advances the head in one
   serialized operation. A stale edit fails without replacing the current artifact.
7. The compiled HTML is a derived current artifact, not revision history. Knowledge
   retains one stable physical HTML path per document; history consists only of source
   block versions and lightweight references.

## Consequences

- A precise edit of one block writes one new block payload and one version row. Other
  blocks add only revision references.
- Workflow replay remains idempotent by `(generation_id, block_id)` and identical
  payload hashes.
- Concurrent edits use optimistic base-revision validation instead of last-writer-wins.
- Existing generation-owned block metadata is migrated into deduplicated logical
  versions and revision mappings. A startup convergence pass rehomes canonical legacy
  payloads to content-addressed keys, normalizes each current HTML to one fixed path,
  and removes unreferenced legacy block/HTML objects.
- This is an incompatible demo-phase refactor. There is no legacy read or write path.
