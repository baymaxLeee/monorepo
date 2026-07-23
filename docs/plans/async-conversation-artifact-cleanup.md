# Async conversation artifact cleanup

## Existing design review

- Chat deletes only its `conversations` row. This remains the correct ownership boundary for the synchronous request, but it is incomplete because no durable notification reaches Knowledge.
- Knowledge owns generated documents and object-store bytes. That ownership remains valid; Chat must not enumerate or delete Knowledge rows itself.
- Knowledge currently says conversation deletion never deletes documents. Keep that behavior only for user-uploaded `source` documents; generated `artifact` documents are conversation-owned by product semantics and must be reclaimed.
- Executor owns durable generation and video workflow state. Do not move storage cleanup into Executor: Knowledge already owns every published Markdown/HTML/image/video object and the HTML block objects. Billing, approval, and production history are not disposable artifacts.

## Official and benchmark alignment

- Use a transactional outbox because deleting Chat state and notifying Knowledge is a distributed dual write. The conversation delete and outbox insert commit in one Chat transaction; a background relay provides at-least-once delivery.
- Make the Knowledge consumer idempotent. A conversation tombstone and a shared transaction-scoped advisory lock serialize cleanup with generated artifact writes, including writes already in flight when deletion begins.
- Treat Knowledge's exact `conversation_deleted` conflict as a permanent Workflow DevKit failure using its native `FatalError`; other transport failures keep the normal retry policy.
- This lifecycle operation does not change `ToolLoopAgent`, UIMessage streaming, or AI Elements. No AI SDK primitive applies and no agent-runtime abstraction is added.
- Claude Code, Codex, and Cursor do not expose a reusable cross-service storage-GC primitive. The applicable benchmark is the standard durable outbox plus idempotent consumer pattern, not an agent persona or sub-agent design.

## Target flow

1. `DELETE /conversations/:id` verifies ownership.
2. One Chat database transaction inserts a unique `conversation.artifacts.delete` outbox row and deletes the conversation. The HTTP response does not wait for Knowledge or object storage.
3. Chat's background relay claims pending rows and calls Knowledge's internal cleanup endpoint. Failed deliveries remain pending and are retried after process restart.
4. Knowledge takes the conversation advisory lock and atomically records a `(user_id, conversation_id)` tombstone. Generated write transactions use the same lock, so cleanup either waits for an earlier writer or makes a later writer observe the tombstone.
5. Knowledge deletes object-store bytes first, then removes generated `documents(kind=artifact)`, HTML generation/block rows, and staged media metadata in one database transaction. Object deletion is idempotent, so a crash is safely retried while metadata still contains the remaining object references.
6. Final metadata deletes return their object references and trigger a second idempotent object cleanup for any reference absent from the initial snapshot.
7. Knowledge returns success only after metadata cleanup commits; Chat then removes the outbox row. Duplicate delivery is a successful no-op.

## Scope

- Delete: generated Markdown/HTML rows, generated image/video rows and bytes, HTML generation/block rows and bytes, staged generated media rows and bytes.
- Preserve: user-uploaded `source` documents, executor video production/cost/approval/audit history, chat-independent Knowledge content.
- Reject late generated writes for a tombstoned conversation.

## Implementation checklist

- [x] Add Chat outbox schema/migration and atomic conversation delete.
- [x] Add a restart-safe Chat relay using row claims and bounded retry backoff.
- [x] Add Knowledge tombstone schema/migration and idempotent internal cleanup route.
- [x] Guard generated artifact/media/generation writes against tombstoned conversations.
- [x] Serialize tombstone creation with generated writes and reclaim references returned by final metadata deletion.
- [x] Map `conversation_deleted` to Workflow DevKit `FatalError` in HTML and video artifact steps.
- [x] Regenerate the Knowledge OpenAPI transport contract.
- [x] Update service docs and ADR.
- [x] Run scoped lint/build, `just sync`, and post-implementation review.
