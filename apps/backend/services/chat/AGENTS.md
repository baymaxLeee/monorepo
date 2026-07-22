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
  `addToolOutput`; AI SDK automatically starts the next request. One call
  batches all currently known independent questions with stable semantic IDs
  and returns structured answers; dependent follow-ups use later continuations.
- Trace persistence is observability and must never fail generation.
- Every model-visible tool returns a ToolOutcome. Business failures stay
  `output-available` for UI/persistence and map to AI SDK `error-json` through
  `toModelOutput` for the primary LLM; Abort, Stop, approval denial, invalid
  input, and protocol failures retain native control flow. Full failed outcomes
  persist in `output_json` with a readable error summary. Do not add automatic
  retry to the wrapper.
- Tool data and progress schemas contain domain payload only. Use
  `toolCompleted`, `toolRunning`, `toolPartial`, `toolBlocked`, or `toolFailed`;
  never repeat protocol-level `ok/status` inside `data` or `progress`.
- The UIMessage SSE stream is a cross-stack contract. Before adding any custom
  `data-*` part / streamed field, read
  `schemas/streaming/chat-uimessage-stream.md` and register it there. Reuse
  official parts first (`text`/`reasoning`/`tool-*`/`file`/`source-*`, message
  `metadata`); only invent a `data-*` part when none fits (a custom part that
  duplicates an official one is a bug).

## Tools and artifacts

- Tool orchestration (ADR-0035): **thin harness — no general runtime
  scheduler or lock.** The SDK owns the tool loop and same-step concurrency;
  `prepareStep` contains only bounded correctness gates: read an explicitly
  selected Plan before execution, and complete the ephemeral HTML
  validate/repair loop from this run's native tool results. A plan-mode model middleware makes only
  `ask_user` and `write_plan`/`update_plan` mutually exclusive: the first group
  emitted for the step remains and later conflicts are dropped, so selected
  plan-tool input keeps streaming live instead of being buffered until the
  model step ends. All other independent tool calls retain native concurrency.
  User-requested HTML revisions are ordinary `edit_file` calls selected by the
  primary ToolLoopAgent; validation-directed repairs use the bounded quality gate.
  todos-before-deliverables ordering is carried by the prompt
  (`renderRuntimeContract` "barrier step": `update_todos` called alone, then
  deliverables dispatched together in the NEXT step) plus the SDK step boundary.
  Todos are not mandatory for every query: plan mode may research, then must
  produce only `write_plan`/`update_plan`; it must not call `update_todos` or any
  content-generation tool. After switching to normal/agent execution mode,
  `update_todos` is an optional visible execution checklist — call it only when
  the task needs a real multi-item breakdown (multiple dependent steps,
  coordinated deliverables, or a plan with multiple checklist items). Hard skip
  for a single actionable item or single deliverable (multi-page HTML still
  counts as one); never emit a one-item todo list, and never use duration alone
  as justification — the deliverable card already shows progress. Simple
  requests directly produce the output without todos.
  Keep tool `execute` non-blocking so the event loop overlaps IO; never
  serialize independent deliverables (md/html/image/video run concurrently via
  the SDK's per-step `Promise.all`). Rare co-emission of todos with a deliverable
  is an accepted cosmetic glitch, not a bug to guard at runtime.
- `write_plan`/`update_plan` snapshots are persisted in native UIMessage tool
  parts. Their successful outputs may include advisory routing hints such as
  `next_suggestion`, used only by the LLM to decide whether a later approved
  normal-mode execution should begin with `update_todos` for multi-item plans.
  Skip that hint for single-deliverable plans. The harness must not read these
  hints as a scheduler, lock, or permission mechanism. Higher-priority
  instructions, user intent, mode policy, and tool schemas always win.
- `update_todos` (normal/agent execution mode only) is a stateless,
  side-effect-free tool: it
  always replaces the full `{id, content, status, deliverable?}` list and has
  no `contextSchema`, no knowledge writes, and no revision/CAS. State lives only
  in the `tool-update_todos` UIMessage part, same as every other tool output.
  It never becomes a second truth source for the plan body (ADR-0017).
  `projectModelContext` does not reconstruct or inject Todo business state. The
  frontend separately renders only the newest `tool-update_todos` part so
  the UI shows one live card instead of one per call (ADR-0017). The optional
  `deliverable` tag (`artifact`/`image`/`video`) links a todo to the one
  concurrent deliverable that fulfills it: because a parallel html/image/video
  step `Promise.all`-blocks until the slowest tool returns, the model cannot
  restate the snapshot mid-step, so the frontend advances each tagged todo live
  from its own deliverable card instead of waiting for the next-step reconcile
  (ADR-0024).
  After `update_todos`, the next model step should execute the ready work
  directly under `runtime_contract` (including parallel deliverables in one
  step); `update_todos` does not return routing advice.
- `write_file`/`edit_file` handle both Markdown and HTML. Markdown runs
  synchronously in this tool call (a single `streamText`, no durability
  needed). **HTML dispatches to the `executor` service and foreground-blocks
  this turn** until compile + publish complete (`agent_task_执行时服务` plan,
  Phase 2; ADR-0015 revision). Progress 100% means block generation completed;
  compile + publish still follow. The generation workflow owns compilation and
  safe publication; the user owns acceptance and requests any follow-up revision.
  The tool `execute`
  is an async generator that consumes `pollTaskSnapshots`
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
- Every successful HTML `write_file` or `edit_file` creates a mandatory local
  Chat quality gate. `prepareStep` scans the current ToolLoop run and exposes
  only `validate_html` until that artifact revision has been checked. The tool
  reads the current revision from Knowledge and runs deterministic validation
  plus a non-blocking content-contract review inside Chat; Executor has no
  validation route, TaskType, or Workflow. No hard findings finishes the gate;
  addressable hard findings produce the existing targeted `edit_file` directive,
  and the new edit triggers `validate_html` again. Do not put this state in
  `projectModelContext`.
- Cancelling a chat run **does** cancel the in-flight executor task the current
  `write_file`/`edit_file` call is blocking on: Stop aborts the turn, the tool's
  `abortSignal` fires, and it calls `POST /tasks/:id/cancel` before unwinding —
  like Cursor aborting an in-flight file write. (The executor task stays durable
  against *process* loss; it is only tied to the turn for user-initiated Stop.)
  Executor task-type compensation also cancels the Knowledge generation or
  recorded Ark video jobs; Workflow run cancellation alone is insufficient.
- `create_video_production` means “create a video production task”, not “render the final
  video”. It blocks only through durable initial storyboard and cost planning,
  then returns `production_id` as soon as the production has left `planning`,
  even when a fast approval moves the projection past the transient
  `awaiting_storyboard_approval` state between Chat polls. The same Workflow run
  remains the sole owner of approvals, paid generation, Take review, assembly,
  and publication. A tagged video todo completes on `production_id`; parallel
  HTML/image tools do not wait for those later phases.
- A normal-mode run carrying `data-plan-execution` forces `read_file` as its
  first and only available tool until the explicitly selected Plan has been
  read completely. A natural-language request to execute a Plan remains an
  agent decision: discover Plans with `list_files`, then use `ask_user` when
  multiple Plans exist. The projector never injects an active Plan or candidate
  list.
- Every run re-resolves mutable authoritative references it uses: Plan from
  Knowledge, activated Skill from Admin's latest published snapshot, and any
  referenced instruction/config file from its owner. Prior read/load outputs are
  not caches. Successful search outputs are historical evidence and must not be
  repeated unless the user explicitly requests refreshed or latest evidence.
- `web_search` uses Exa Search as the primary source
  (`POST https://api.exa.ai/search`, `x-api-key`) and Tavily Search as fallback
  (`POST https://api.tavily.com/search`, `Authorization: Bearer`). Freshness is
  handled two ways so the model never falls back to its training-cutoff year:
  (1) the current date is injected into the agent instructions as a trailing
  `<environment>` block (single source of truth — `renderEnvironment` in
  `context/instructions/assembler.ts`, assembled last so the static prompt
  prefix stays cache-stable);   (2) the tool keeps its own `category`/`time_range`/`start_date`/`end_date`
  inputs so recency is a structured, server-side filter rather than a year
  stuffed into the query. Exa freshness uses two distinct levers together:
  `startPublishedDate`/`endPublishedDate` bias WHICH results return (by publish
  date; from an explicit range or derived from `time_range`), while `maxAgeHours`
  (derived from `time_range`: day/week/month/year → 24/168/744/8760) forces a
  livecrawl of stale page CONTENT. `category` maps to Exa `news`/`research paper`
  (and to Tavily's `topic`). Snippets prefer Exa `highlights` (token-efficient);
  the heavier whole-page `summary` is requested only for `research_paper`. If Exa
  fails or returns no results and `TAVILY_API_KEY` is configured, the tool falls
  back to Tavily `search_depth: "advanced"`; Tavily is optional (Exa is primary).
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

- `src/api/http/routes/agents.ts` — run stream and trace routes
- `src/application/agent/runs/run.ts` — request/stream/persistence orchestration
- `src/application/agent/agents/tool-loop.ts` — ToolLoopAgent implementation
- `src/application/agent/tools/catalog.ts` — manifest resolution and run-scoped extension assembly
- `src/application/agent/context/projector.ts` — bounded model context projection
- `src/application/agent/README.md` — module boundaries and extension rules
- `src/gen-openapi.ts` — OpenAPI export

Run from `apps/backend`: `just lint chat`, `just build chat`,
`just gen-openapi chat`.
