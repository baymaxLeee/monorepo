# ADR 0058: Executor task status uses the Workflow durable stream

## Status

Accepted. Amends ADR-0035 without changing its single-browser-stream decision.

## Context

Chat waits for Executor-backed file and video work by polling `GET /tasks/:id`
every 1.5 seconds. Video creation also polls `GET /video-productions/:id` until
storyboard and cost planning are durable. The polling snapshots are correct,
but they couple notification latency and request volume to a Chat timer.

Executor already runs every task in Workflow DevKit on the Postgres World.
That World provides a reliable Graphile Worker queue and persistent Workflow
streams through `getWritable()` and `getRun(runId).getReadable()`. Adding a
second broker for one owner/consumer would duplicate queueing, persistence,
replay, and operations.

ADR-0035 correctly removed Executor-owned browser progress SSE and kept all
browser progress on the main AI SDK UIMessage stream. It also removed every
Executor outbound notification. The latter is too broad: a service-to-service
Workflow stream does not create a second browser protocol.

## Decision

- Task creation, cancellation, ownership, and snapshot reads remain HTTP.
- Workflow steps emit lightweight change signals only after Executor business
  state has been committed.
- Executor exposes an authenticated per-task SSE route backed by the Workflow
  run's persistent readable stream.
- The route treats change signals as wakeups, re-reads Executor's task and
  optional video-production projection, and sends authoritative snapshots.
- The task and production tables remain the only business truth. Essential
  video milestone signals run as separate retryable Workflow steps, so a
  stream retry never repeats the committed business mutation.
- Chat consumes the status stream and reconnects it after transport interruption.
  Every connection begins with a current authoritative snapshot, so task
  waiting never needs a parallel or fallback polling loop.
- Chat continues to surface snapshots as preliminary official tool results on
  its one resumable UIMessage stream. No browser-facing stream or custom
  `data-*` part is added.
- No Kafka, RabbitMQ, NATS, Redis Pub/Sub, outbox/inbox tables, or general event
  bus is introduced.

## Consequences

- Chat observes progress and video-planning milestones without fixed polling.
- A disconnected Chat can reconnect and immediately receive the current
  authoritative snapshot; persisted Workflow chunks wake active consumers.
- Duplicate or replayed notifications are harmless because snapshots are
  monotonic by task `updatedAt` and production `version`.
- Executor owns access to its Workflow World and business database; Chat never
  connects to either database directly.
- If future requirements add several independent consumers, cross-domain event
  replay, or long-term audit streams, a general event bus remains a separate
  decision. NATS JetStream is the leading lightweight candidate; this ADR does
  not preselect or emulate it.

## References

- Installed `workflow@4.5.0`:
  `node_modules/workflow/docs/foundations/streaming.mdx`
- Installed `@workflow/world-postgres@4.2.0`:
  `node_modules/@workflow/world-postgres/README.md`
- ADR-0013: resumable UIMessage stream transport
- ADR-0035: tool orchestration and unified browser progress stream
