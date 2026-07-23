# ADR 0052: Reliable asynchronous cleanup of conversation artifacts

## Status

Accepted.

## Context

Deleting a Chat conversation removed only Chat-owned rows. Knowledge retained generated Markdown, HTML, images, videos, HTML block objects, and staged media tagged with the conversation. Calling Knowledge directly from the delete request would either add object-store latency to the main path or create an unsafe distributed dual write.

The cleanup also races durable Executor workflows: a generation that started before deletion can publish after a one-shot cleanup and recreate the leak.

## Decision

Chat records a `conversation.artifacts.delete` transactional-outbox row in the same database transaction that deletes the conversation. The request returns after that local commit. A restart-safe background relay delivers the command to an idempotent Knowledge internal endpoint with at-least-once semantics.

Knowledge records a durable conversation tombstone before cleanup. The tombstone transaction and every generated artifact write transaction take the same transaction-scoped PostgreSQL advisory lock derived from `conversation_id`. A writer that acquired the lock first commits before cleanup scans; a writer that arrives after cleanup waits and then observes the tombstone. This closes the in-flight writer window instead of merely rejecting writes that started after the tombstone committed.

Generated artifact, media, staged-media, and HTML-generation write paths reject tombstoned conversations. Cleanup removes generated `artifact` documents, staged media, artifact generations, block metadata, all referenced object-store bytes, and cached vision variants derived from generated images. It deliberately preserves uploaded `source` documents and Executor billing/approval/audit history.

Object bytes discovered by the cleanup snapshot are deleted before their metadata rows. The final metadata deletes use `DELETE ... RETURNING` and perform a second idempotent object deletion for any reference not present in the snapshot. The advisory-lock protocol is the primary concurrency invariant; the returned references are defense in depth for unexpected or older unguarded writers.

Executor maps Knowledge's exact `409 conversation_deleted` response to Workflow DevKit's `FatalError`. Deletion is a permanent lifecycle decision, so retrying the affected generation step cannot succeed and only creates delay and log noise.

## Consequences

- Conversation deletion has only local database latency and does not wait for Knowledge or object storage.
- Delivery and cleanup are eventually consistent and at least once; the Knowledge endpoint is idempotent.
- A permanent Knowledge failure leaves an observable outbox row instead of silently leaking artifacts.
- Tombstones are retained so arbitrarily late durable workflows cannot recreate deleted conversation artifacts.
- The relay claim is a one-minute recovery lease. Multiple Chat replicas can redeliver a long-running cleanup after the lease expires; this is safe because Knowledge cleanup and object deletion are idempotent. Replace the fixed lease with renewal only when measured cleanup duration or duplicate load warrants it.
- Two small service-owned migrations are required; no broker or new general-purpose job framework is introduced.
