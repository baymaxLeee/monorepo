# chat service (TypeScript)

Conversation + agent runtime service. It owns conversation/message/run
observability in PostgreSQL and consumes admin (providers), knowledge
(documents/artifacts), and executor (durable background tasks) through
`@backend/transport-ts`.

## Runtime contract

- The core agent is AI SDK v7 `ToolLoopAgent`; one POST creates one run.
- Browser disconnect only drops an SSE subscriber. Redis retains the native
  UIMessage SSE so `useChat.resumeStream()` can attach through the GET route.
- Stop uses the run cancellation endpoint. Propagate the server-owned run
  `AbortSignal` into model, search, multimodal, and nested artifact model calls.
- Explicit Stop finalizes every unfinished official tool part as
  `output-error`, persists unfinished todos as `cancelled`, and waits for the
  local run finalizer before returning. Route cleanup only detaches the stream.
- Replay is a transport concern only: never model it as ToolLoopAgent state or
  claim process-crash resume. Plans and messages remain durable business context.
- `ask_user` is a client tool without `execute`. The browser supplies
  `addToolOutput`; AI SDK automatically starts the next request.
- Trace persistence is observability and must never fail generation.
- The UIMessage SSE stream is a cross-stack contract. Before adding any custom
  `data-*` part / streamed field, read
  `schemas/streaming/chat-uimessage-stream.md` and register it there. Reuse
  official parts first (`text`/`reasoning`/`tool-*`/`file`/`source-*`, message
  `metadata`); only invent a `data-*` part when none fits (a custom part that
  duplicates an official one is a bug).

## Tools and artifacts

- Tool orchestration (ADR-0035): **thin harness — no runtime scheduler/lock, no
  `concurrency` policy.** The SDK owns the tool loop; the prompt supplies policy.
  plan/todos-before-deliverables ordering is carried by the prompt
  (`renderRuntimeContract` "barrier step": `update_todos` called alone, then
  deliverables dispatched together in the NEXT step) plus the SDK step boundary.
  Todos are not mandatory for every query: plan mode may research, then must
  produce only `write_plan`/`update_plan`; it must not call `update_todos` or any
  content-generation tool. After switching to normal/agent execution mode,
  `update_todos` is an optional visible execution checklist — call it only when
  the task cannot be completed directly (large decomposition, multiple dependent
  steps, coordinated deliverables, or long-running work where user-visible
  progress matters); simple requests directly produce the output without todos.
  Keep tool `execute` non-blocking so the event loop overlaps IO; never
  serialize independent deliverables (md/html/image/video run concurrently via
  the SDK's per-step `Promise.all`). Rare co-emission of todos with a deliverable
  is an accepted cosmetic glitch, not a bug to guard at runtime.
- `update_plan` snapshots are persisted in native UIMessage tool parts.
- `update_todos` (normal/agent execution mode only) is a stateless,
  side-effect-free tool: it
  always replaces the full `{id, content, status, deliverable?}` list and has
  no `contextSchema`, no knowledge writes, and no revision/CAS. State lives only
  in the `tool-update_todos` UIMessage part, same as every other tool output.
  It never becomes a second truth source for the plan body (ADR-0017).
  Because it has no read-back tool, `projectModelContext` always reinjects
  the latest completed call (via `latestCompletedToolOutput`) as
  `<current_todo_list>` so it survives `pruneMessages`/compaction; the
  frontend separately renders only the newest `tool-update_todos` part so
  the UI shows one live card instead of one per call (ADR-0017). The optional
  `deliverable` tag (`artifact`/`image`/`video`) links a todo to the one
  concurrent deliverable that fulfills it: because a parallel html/image/video
  step `Promise.all`-blocks until the slowest tool returns, the model cannot
  restate the snapshot mid-step, so the frontend advances each tagged todo live
  from its own deliverable card instead of waiting for the next-step reconcile
  (ADR-0024).
- `write_file`/`edit_file` handle both Markdown and HTML. Markdown runs
  synchronously in this tool call (a single `streamText`, no durability
  needed). **HTML dispatches to the `executor` service and foreground-blocks
  this turn** (`agent_task_执行时服务` plan, Phase 2; ADR-0015 revision). The
  tool `execute` is an async generator that consumes `pollTaskSnapshots`
  (`agent/tasks/executor-task.ts`): it yields a preliminary `{ status, task_id }`
  (so the card mounts at once), then polls `GET /tasks/:id`, yielding running
  `{ status: "running", blocks_done, blocks_total }` snapshots, and finally
  `{ status: "completed", document_id, ... }`. Progress rides the **main**
  useChat UIMessage stream as preliminary `tool-*` results — there is NO separate
  task-progress SSE, no `data-artifact-progress`, and no executor→chat push
  (ADR-0035). The ToolLoopAgent waits for the document before its next step —
  this is what stops the model from dispatching a second competing edit for an
  artifact still being written. The `GET /tasks/:id` poll is the authoritative
  completion signal (executor's `tasks.progress` column is the only progress
  source; Knowledge is not). `GET .../tasks/:taskId` stays as a plain JSON read
  for cold-start/debug. Knowledge/ObjectStore owns full content; chat history and
  traces never carry HTML fragments.
- `html_validate` validates and inspects an already-published HTML artifact;
  it stays local to chat since it needs no LLM call and no durability.
- Cancelling a chat run **does** cancel the in-flight executor task the current
  `write_file`/`edit_file` call is blocking on: Stop aborts the turn, the tool's
  `abortSignal` fires, and it calls `POST /tasks/:id/cancel` before unwinding —
  like Cursor aborting an in-flight file write. (The executor task stays durable
  against *process* loss; it is only tied to the turn for user-initiated Stop.)
  Executor task-type compensation also cancels the Knowledge generation or
  recorded Ark video jobs; Workflow run cancellation alone is insufficient.
- `web_search` uses Tavily. Freshness is handled two ways so the model never
  falls back to its training-cutoff year: (1) the current date is injected into
  the agent instructions as a trailing `<environment>` block (single source of
  truth — `renderEnvironment` in `context/instructions/assembler.ts`, assembled
  last so the static prompt prefix stays cache-stable); (2) the tool exposes
  Tavily's
  native `topic`/`time_range`/`start_date`/`end_date` filters so recency is a
  structured, server-side filter rather than a year stuffed into the query.
  `create_memory`/`update_memory` stage a candidate; user approval remains
  asynchronous in the memory panel.
- Built-ins are grouped by capability under `tools/builtins/` but remain one
  flat AI SDK ToolSet. `manifest.ts` is the source of tool policy, planning
  capability projection, and UI metadata. Plan mode receives only callable
  research/planning tools plus a generated summary of execution capabilities.
- Long-running executor start/poll/cancel helpers live in
  `agent/tasks/executor-task.ts`, outside the model-facing tools boundary.

## Boundaries

- No direct imports from another service.
- Service URLs, internal auth, DTOs and timeouts live in transport-ts clients;
  chat-local clients only add cache/error mapping.
- User identity belongs to iam, provider configuration to admin, and document /
  artifact storage to knowledge.
- DB transactions (ADR-0037): multi-step / multi-table writes use
  `getDb().transaction(async (tx) => ...)` (auto commit/rollback), threading
  `tx` through every read/write; single-statement writes stay bare. Cross-table
  finalization and external side effects stay OUTSIDE the tx — e.g.
  `acquireRunLease` reaps + claims the lease in one tx, then runs `finishAgentRun`
  after it.

## Entry points

- `src/routes/agents.ts` — run stream and trace routes
- `src/agent/runs/run.ts` — request/stream/persistence orchestration
- `src/agent/agents/tool-loop.ts` — ToolLoopAgent implementation
- `src/agent/tools/catalog.ts` — manifest resolution and run-scoped extension assembly
- `src/agent/context/projector.ts` — bounded model context projection
- `src/agent/README.md` — module boundaries and extension rules
- `src/gen-openapi.ts` — OpenAPI export

Run from `apps/backend`: `just lint chat`, `just build chat`,
`just gen-openapi chat`.
