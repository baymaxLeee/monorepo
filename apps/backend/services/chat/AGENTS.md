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
  `prepareStep` is the project's `PostToolBatch` / `prepareNextTurn` adapter and
  contains only the bounded gate that reads an explicitly selected Plan before
  execution. A model middleware in every mode makes
  `ask_user` and plan-mode `write_file` mutually exclusive: the first group
  emitted for the step remains and later conflicts are dropped, so selected
  plan-tool input keeps streaming live instead of being buffered until the model
  step ends. It also makes `load_skill` a batch barrier. All other independent
  tool calls retain native concurrency.
  User-requested text and HTML revisions are ordinary exact `edit_file` calls
  selected by the primary ToolLoopAgent.
  If a user asks to execute or resume work while the current run is still in
  plan mode, the agent stops without tools and tells the user to switch to Agent
  mode; execution tools remain absent from the plan-mode ToolSet.
  todos-before-deliverables ordering is carried by the prompt
  (`renderRuntimeContract` "barrier step": `update_todos` called alone, then
  deliverables dispatched together in the NEXT step) plus the SDK step boundary.
  Todos are not mandatory for every query: plan mode may research, then must
  produce only one complete-plan `write_file`; it must not call `update_todos` or any
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
- `write_file` is the sole text persistence primitive in both modes. It writes
  complete UTF-8 content to a relative path. Plan mode validates `*-plan.md`
  headings/checklist and records that path as the active Plan; `edit_file` is
  available only in normal mode and applies atomic exact replacements.
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
- File tools are one path-based capability: `list_files`, `read_file`,
  `search_files`, `write_file`, `edit_file`, and `check_file`. Exact
  `write_file`/`edit_file` own small and sequential HTML. `delegate_tasks` is a
  separate generic orchestration capability used only when independent file
  outputs would strain the primary model's output/context budget.
- `delegate_tasks` freezes one shared context plus unique
  `{id,instruction,output_path}` tasks and starts Executor's durable
  `file-task-batch`. Workers do not receive the conversation or HTML planning
  authority. Each worker returns one complete file; Chat atomically promotes the
  successful batch. Progress rides preliminary official `tool-delegate_tasks`
  parts.
- HTML remains a complete browser artifact in both paths. Direct and delegated
  output may use scripts, modules, dynamic DOM, Canvas/SVG/WebGL, forms, media,
  workers, and external runtimes. Capability is never inferred from page count.
  Preview isolation comes from an opaque-origin iframe sandbox with scripts
  enabled, not from stripping browser features out of generated content.
- Every successful `write_file`/`edit_file` is promoted immediately and can be
  previewed without a verification state. `check_file` is an optional read-only
  diagnostic for markup, links, local resources, CSS, and inline script syntax;
  it neither mutates files nor blocks delivery or imposes design policy.
- Cancelling a chat run **does** cancel the in-flight executor task the current
  `delegate_tasks` call is blocking on: Stop aborts the turn, the tool's
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
- Redis clients are created only through `infrastructure/redis`: ordinary
  commands share `getRedisClient()`, blocking stream reads use `duplicate()`,
  and readiness probes use an isolated client from `createRedisClient()`.
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
