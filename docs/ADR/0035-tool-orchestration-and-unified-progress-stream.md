# ADR 0035: Tool orchestration (thin harness: step boundary + prompt) and unified progress stream

## Status

Accepted. Refines ADR 0011 (ToolLoopAgent core), ADR 0022 (parallel deliverable
execution), ADR 0024 (deliverable-tagged live todos). Supersedes the "task
progress rides a separate task-scoped SSE stream" design of ADR 0015 (agent task
executor) and the "deliberately separate granularities" note in
`schemas/streaming/chat-uimessage-stream.md`. Removes the executor→chat outbound
notification contract described in ADR 0015 / executor `AGENTS.md`.

## Context

Three requirements drove this change:

1. Plan mode may use research/context tools first, then must produce only
   `write_plan`/`update_plan`; it must not call `update_todos` or deliverable
   generation tools. In normal/agent execution mode, when the model uses a todo
   barrier, `update_todos` should not interleave with deliverable tool calls —
   that snapshot should settle before deliverables run. Todos are selective
   progress UI, not a mandatory step for every query.
2. HTML-artifact progress was delivered over a **second** SSE channel
   (`GET /conversations/:id/tasks/:taskId/stream`, fed by executor pushing to
   chat's `POST /internal/tasks/notify` → Redis `chat:task-streams:*`), consumed
   by a dedicated `ArtifactTaskCard` connection — separate from the main
   `useChat` UIMessage stream. It should collapse into the one AI SDK stream.
3. md / html / image / video deliverables must run concurrently, not block each
   other.

Verified constraints (against `ai@7.0.15`):

- A step executes every tool call via `Promise.all(...map(executeToolCall))`
  after `model-call-end`. `prepareStep`/`activeTools`/`toolChoice` are
  **step-level** only; there is no public hook that hands userland the full
  tool-call batch *before* execution (`onStepStart` fires pre-model with no
  tool calls; `onToolExecutionStart` is per-tool; `onStepEnd` is post-execution).
- Node's single-threaded event loop already overlaps IO-bound tool calls in a
  step's `Promise.all` — concurrency (#3) is free as long as tools stay
  non-blocking and nothing serializes them artificially.
- `getTask` (`TaskSnapshot`) already returns `progress {done,total}`, and the
  HTML/video tools already foreground-poll `GET /tasks/:id`. So progress can be
  read from the tool's own poll and surfaced on the main stream.

## Decision

### 1. Orchestration: thin harness — step boundary + prompt, no runtime gate

- **Ordering comes from the SDK step boundary + the prompt.** Plan mode only
  writes the plan (`write_plan`/`update_plan`) after optional research/context
  tools. After the user switches to normal/agent execution mode, when a todo
  barrier is useful, the model calls `update_todos` in its own step — enforced by
  the `renderRuntimeContract` "barrier step" rule
  (`agent/context/instructions/runtime.ts`, aligned with Claude Code / Codex
  TodoWrite usage): `update_todos` is called alone, then deliverables dispatch
  together in the NEXT step. The SDK runs steps sequentially, so those
  deliverables start strictly after.   `update_todos` is selective visible tracking
  for substantial multi-item execution, skipped for Q&A / single deliverables /
  one-item lists (multi-page single artifacts still skip). Duration alone is
  not a reason — the deliverable tool card shows progress.
- **No run-scoped scheduler or concurrency lock.** On this SDK there is no
  public hook to see a step's full tool-call batch before execution, so a hard
  intra-step guarantee is impossible; an earlier writer-priority gate was
  removed because it (a) could not provide that guarantee, (b) triggered
  essentially never once the prompt makes `update_todos` a barrier step, and
  (c) fought the thin-harness principle (the SDK owns the tool loop; the prompt
  supplies policy). If the model rarely co-emits plan/todos with a deliverable,
  that is an accepted, cosmetic glitch — not worth a runtime mechanism.
- Deliverables in one step run concurrently via the SDK's per-step
  `Promise.all` + Node's non-blocking IO (#3); tools stay non-blocking so the
  event loop overlaps their IO. Nothing serializes independent deliverables.

### 2. Unified progress: one stream, preliminary tool-results

- HTML-artifact and video progress ride the **main** `useChat` UIMessage stream.
  `write_file`/`edit_file` and `generate_video` consume `pollTaskSnapshots`
  (`agent/tasks/executor-task.js`), `yield`ing running snapshots
  (`blocks_done`/`blocks_total`, `progress_done`/`progress_total`) that the SDK
  emits as preliminary `tool-*` results, then a terminal `yield` with
  `document_id`. `ChatArtifactCard`/`ChatVideoCard` read progress off the tool
  part; no second connection.
- `generate_images` stays chat-internal and two-phase (`generating` →
  `completed` with `images[]`); it has no executor task and needs no polling.
- An **executor-reported terminal failure/cancellation** is surfaced as a
  structured tool output — a final `yield { ok: false, status: "failed" |
  "cancelled", error, ... }` — not a thrown error, so the artifact/video card
  renders its failed state off the tool part. Only poll network errors, the
  wait timeout, run-abort (user Stop), and tool implementation bugs still throw
  (→ `output-error`).
- **Progress source matrix:** HTML/video → poll executor `tasks.progress`
  (executor keeps writing it via `reportTaskProgress`, minus the push); images →
  chat-internal `Promise.allSettled` two-phase output; Knowledge stores only
  terminal document content and is never a progress source.
- Deleted: chat `agent/streams/task-progress.ts`, the task-stream Redis helpers,
  `GET .../tasks/:taskId/stream`, `POST /internal/tasks/notify` (+ chat internal
  auth middleware), the executor→chat push (`notifyOwner*`,
  `executor/src/clients/chat.ts`, `transport-ts` `ChatInternalClient` /
  `notifyTaskEvent`), and the frontend `openConversationTaskStream`. The
  read-only `GET .../tasks/:taskId` JSON snapshot stays for cold-start/debug.

### 3. Orchestration spec (event-loop discipline)

Tool authors must keep `execute` non-blocking (all IO `await`ed; no CPU-heavy
sync work on the event loop); rely on the SDK's per-step `Promise.all` for
deliverable concurrency and never serialize independent deliverables; fan out
internally (`Promise.allSettled`/`mapConcurrent`); stream long-running progress
via async generators (terminal state as the last `yield`, never `return`); order
plan/todos via the prompt barrier step, not a runtime lock; use timer-based
`abortableSleep` for polling; propagate the run `AbortSignal`; and add no
artificial concurrency caps (provider limits + executor bound it).

## Consequences

- One protocol, one resumable transport (Redis agent-run stream) for all
  progress; refresh/reconnect replays it. Mid-flight progress need not be
  perfectly restored, but terminal `completed`/`failed`/`cancelled` always lands
  on the tool card.
- Executor is simpler: no outbound notifications, progress is a plain column the
  owner polls. `reportTaskProgress` keeps writing `tasks.progress`.
- plan/todos-before-deliverables ordering is prompt-enforced (the barrier step)
  plus the SDK step boundary; there is no runtime guarantee, and none is
  attempted. A true intra-step guarantee would require forking the SDK's
  `executeToolsFromStream` and is explicitly out of scope. Rare co-emission is an
  accepted cosmetic glitch.
