# ADR-0005: chat durable WorkflowAgent runtime

## Status

Accepted — 2026-06

## Context

- The chat service used an in-process AI SDK agent loop plus Redis SSE replay.
- A process crash, local restart, or deploy could lose the active run; HITL and
  long artifact generation were especially fragile.
- The project prefers AI-native primitives over custom orchestration when the
  official AI SDK/Workflow stack covers the use case.

## Decision

1. **Use `@ai-sdk/workflow` `WorkflowAgent` as the run host.**
   - Hono stays as the HTTP framework.
   - Nitro + `workflow/nitro` becomes the build/runtime host for chat.
   - React micro-frontend stays; no Next.js migration is part of this change.

2. **Use Workflow streams for resume.**
   - POST starts a workflow run and returns `x-workflow-run-id`.
   - GET resumes with `{api}/{workflowRunId}/stream?startIndex=...`.
   - Frontend uses `WorkflowChatTransport`.

3. **Persist business state server-side.**
   - `agent_runs` stores `workflow_run_id`, `workflow_name`, and
     `workflow_version`.
   - Workflow completion writes the assistant message and final run status.
   - Client `onChatEnd` is only a reconcile hook.

4. **Keep Workflow World separate from business MySQL.**
   - Workflow run/step/event state uses Workflow World.
   - Deployments use self-hosted Postgres World via `@workflow/world-postgres`.
   - Chat business tables remain in MySQL.

5. **Guard cross-version resume.**
   - Each run records `CHAT_WORKFLOW_VERSION`.
   - Resume/cancel rejects mismatched versions with `WORKFLOW_VERSION_MISMATCH`.
   - Full version-routed execution is a future production hardening task.

6. **Use backend transport SDKs for service-to-service calls.**
   - Chat calls admin and knowledge through `@backend/transport-ts`.
   - Chat-local clients are facades for cache/error mapping; they do not own
     service URL construction or internal-token transport concerns.
   - Workflow cross-service I/O stays inside `'use step'` functions.

## Consequences

- Redis is no longer the primary stream replay mechanism for chat runs.
- Workflow modules must not statically import Node-only dependencies such as
  Drizzle, mysql2, or `node:crypto`; DB work belongs in `'use step'` functions.
- Current migration establishes durable model streaming, resume, cancel,
  server-side final persistence, and the full workflow-safe tool set
  (`list_documents`, `read_document`, `web_search`, `create_artifact`,
  `update_artifact`, `analyze_image`, `ask_user`, `propose_memory`).
  Token-by-token artifact preview during generation remains follow-up parity work.
- HTML artifacts are generated as structured `{ title, style, body, script }`
  parts and assembled by chat into a deterministic HTML5 document shell. The
  model no longer owns closing `</html>` or document wrapper correctness. For
  visualization, the shell conditionally supplies a version-pinned ECharts
  runtime with SRI. The model emits chart configuration against `window.echarts`
  instead of hand-written canvas code. A restrictive CSP allows that pinned
  script plus inline artifact code, but blocks arbitrary remote scripts and
  outbound connections. Structured-output failures fall back to section-envelope
  generation. Artifact-local JavaScript errors are isolated by the iframe and
  shown by its runtime error boundary instead of failing persistence or producing
  an unexplained blank preview.
- Artifact progress streams carry a bounded tail preview and generated-size
  metadata rather than repeated full-file snapshots. `toolCallId` is the
  idempotency key for artifact creation.
- Artifact updates use `updated_at` as an optimistic-concurrency base version.
  Large artifacts are revised in bounded chunks before an atomic conditional
  write; concurrent changes fail instead of being silently overwritten.
- Conversation history remains in native model messages. Historical user text
  is never copied into agent instructions.
- A user pause aborts only the browser stream and leaves the Workflow run
  active. Manual resume currently discards the unfinished in-memory assistant
  snapshot and replays the durable stream from index zero. Tail-only replay is
  invalid because UIMessage text/tool deltas cannot hydrate without their start
  chunks, and the main/artifact namespaces do not yet share one cursor.
- Demo phase still skips new test scaffolding; verification is lint/build plus
  manual run/resume/crash/cancel scenarios.

## Alternatives considered

- Extend Redis SSE replay: rejected because it keeps run ownership tied to the
  HTTP process and duplicates Workflow SDK responsibilities.
- Migrate the frontend to Next.js: rejected as unrelated to durable agent runs
  and disruptive to the existing Module Federation architecture.
- Move all chat business data to Postgres now: rejected; Workflow World and
  business storage have different ownership and migration risk.
