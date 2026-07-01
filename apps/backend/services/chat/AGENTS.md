# chat service (TypeScript)

Conversation + agent runtime service. It owns conversation/message/run
observability in MySQL and consumes admin (providers), knowledge
(documents/artifacts), and executor (durable background tasks) through
`@backend/transport-ts`.

## Runtime contract

- The core agent is AI SDK v7 `ToolLoopAgent`; one POST creates one run.
- Browser disconnect only drops an SSE subscriber. Redis retains the native
  UIMessage SSE so `useChat.resumeStream()` can attach through the GET route.
- Stop uses the run cancellation endpoint. Propagate the server-owned run
  `AbortSignal` into model, search, multimodal, and nested artifact model calls.
- Replay is a transport concern only: never model it as ToolLoopAgent state or
  claim process-crash resume. Plans and messages remain durable business context.
- `ask_user` is a client tool without `execute`. The browser supplies
  `addToolOutput`; AI SDK automatically starts the next request.
- Trace persistence is observability and must never fail generation.

## Tools and artifacts

- `update_plan` snapshots are persisted in native UIMessage tool parts.
- `update_todos` (both modes) is a stateless, side-effect-free tool: it
  always replaces the full `{id, content, status}` list and has no
  `contextSchema`, no knowledge writes, and no revision/CAS. State lives only
  in the `tool-update_todos` UIMessage part, same as every other tool output.
  It never becomes a second truth source for the plan body (ADR-0017).
  Because it has no read-back tool, `projectModelContext` always reinjects
  the latest completed call (via `latestCompletedToolOutput`) as
  `<current_todo_list>` so it survives `pruneMessages`/compaction; the
  frontend separately renders only the newest `tool-update_todos` part so
  the UI shows one live card instead of one per call (ADR-0017).
- `write_file`/`edit_file` handle both Markdown and HTML. Markdown runs
  synchronously in this tool call (a single `streamText`, no durability
  needed). **HTML dispatches to the `executor` service and foreground-blocks
  this turn** (`agent_task_执行时服务` plan, Phase 2; ADR-0015 revision). The
  tool `execute` is an async generator: it yields a preliminary
  `{ status, task_id }` (so the card mounts at once), then polls
  `GET /tasks/:id` until the task is terminal, then yields
  `{ status: "completed", document_id, ... }`. The ToolLoopAgent waits for the
  document before its next step — this is what stops the model from dispatching
  a second competing edit for an artifact still being written. Live per-block
  progress reaches the browser over `GET /conversations/:id/tasks/:taskId/stream`
  — a native AI SDK UIMessage SSE stream (data part `data-artifact-progress`)
  on the same resumable Redis Streams transport as agent runs — fed by executor
  pushing progress/terminal events to chat's `/internal/tasks/notify`. That push
  is the **UX channel only**; the tool's `GET /tasks/:id` poll is the
  authoritative completion signal, so a dropped best-effort notify never hangs
  the blocking tool. `GET .../tasks/:taskId` stays as a plain JSON read for
  cold-start/debug. Knowledge/ObjectStore owns full content; chat history and
  traces never carry HTML fragments.
- `run_command` (`validate_html`/`inspect_layout`) inspects an already
  *published* HTML artifact; it stays local to chat since it needs no LLM
  call and no durability.
- Cancelling a chat run **does** cancel the in-flight executor task the current
  `write_file`/`edit_file` call is blocking on: Stop aborts the turn, the tool's
  `abortSignal` fires, and it calls `POST /tasks/:id/cancel` before unwinding —
  like Cursor aborting an in-flight file write. (The executor task stays durable
  against *process* loss; it is only tied to the turn for user-initiated Stop.)
- `web_search` uses Tavily. `create_memory`/`update_memory` stage a candidate;
  user approval remains asynchronous in the memory panel.

## Boundaries

- No direct imports from another service.
- Service URLs, internal auth, DTOs and timeouts live in transport-ts clients;
  chat-local clients only add cache/error mapping.
- User identity belongs to iam, provider configuration to admin, and document /
  artifact storage to knowledge.

## Entry points

- `src/routes/agents.ts` — run stream and trace routes
- `src/agent/runs/run.ts` — request/stream/persistence orchestration
- `src/agent/agents/tool-loop.ts` — ToolLoopAgent implementation
- `src/agent/tools/catalog.ts` — built-in tools and run-scoped extension assembly
- `src/agent/context/projector.ts` — bounded model context projection
- `src/agent/README.md` — module boundaries and extension rules
- `src/gen-openapi.ts` — OpenAPI export

Run from `apps/backend`: `just lint chat`, `just build chat`,
`just gen-openapi chat`.
