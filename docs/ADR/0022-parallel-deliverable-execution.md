# ADR 0022: Parallel deliverable execution (concurrent html / image / video generation)

## Status

Accepted. Builds on ADR 0011 (ToolLoopAgent core), ADR 0015 (executor
foreground-blocking tools), ADR 0017 (agent todo list), and ADR 0018 (video
workflow). Complements ADR 0021 (lightweight media cards), which owns how the
concurrently-produced deliverables are *rendered*.

## Context

A single task often needs several deliverables at once — e.g. a marketing brief
that wants an HTML landing page, a promo video, and a batch of posters. The
product goal is that mutually independent deliverables generate **concurrently**,
especially in the plan → execute flow (plan mode drafts the work, execute mode
produces it).

Re-derived from first principles, all three layers already support concurrency:

- **Agent runtime (AI SDK v7):** `executeToolsFromStream` runs every tool call in
  a step via `Promise.all(toolCallsToExecute.map(...))` and concurrently consumes
  each tool's async generator (`node_modules/ai/dist/index.js`). `ToolLoopAgent`
  is created with `parallelToolCalls: true`
  (`services/chat/src/agent/agents/tool-loop.ts`). So `write_file` +
  `generate_image` + `generate_video` emitted in the **same step** already run in
  parallel — the foreground-block of each tool blocks only its own call.
- **Executor:** each `POST /tasks` starts an independent `workflow` run
  (graphile-worker default concurrency 10), with per-task internal fan-out
  (`BLOCK_CONCURRENCY=4` for HTML, `SCENE_CONCURRENCY=5` for video). No
  session/user/global serial lock.

The only real bottleneck is therefore **whether the model emits the independent
deliverables in one step**. Two failure modes pushed it toward serial: a
multi-image request tempted one `generate_image` call per image, and the
plan → execute flow seeded a flat `## 任务` checklist that the executor walked one
todo at a time.

## Decision

Make concurrency reliable at the seams the model actually controls, without
inventing an orchestrator and without touching the executor contract.

1. **Reuse the SDK's native same-step concurrency.** No bespoke parallel-dispatch
   engine, no fan-out task type. Concurrency = the model issuing independent tool
   calls in one step; the SDK's `Promise.all` does the rest. This matches how
   Claude Code / Cursor parallelize independent tool calls.

2. **Deterministic image batching (model-independent).** `generate_image` takes a
   `prompts[]` array (was `{ prompt, n }`); it runs one `generateImage` per prompt
   concurrently via `Promise.allSettled`, persists each as its own document, and
   returns one grouped result with `count` / `failed`. A multi-image request is
   thus a single tool call that is *always* concurrent regardless of model
   behavior, and it fails soft (a dead prompt drops from the gallery). This also
   cuts the number of parallel calls the model must co-emit for a cross-type
   batch (e.g. HTML + video + 5 posters → 3 calls, not 7).

3. **Plans encode concurrency; execution honors it.** The plan template
   (`agent/plans/service.ts` `PLAN_CONTENT_DESCRIPTION` + plan-mode instructions)
   requires `## 任务` to group mutually-independent deliverables under a
   `### 并行产物（可同时生成）` subheading and to note real dependencies inline
   (e.g. `(依赖：上面的海报)`). The execute-mode `<referenced_plan>` instruction
   dispatches every deliverable in a parallel group in the **same step** (and
   marks those todos `in_progress` together); only steps the plan marks dependent
   run afterward. The parallel group is **prompt-level guidance the model reads** —
   there is deliberately no code that parses it, so no new machinery.

4. **Keep foreground-blocking (ADR-0015 unchanged).** Each generation tool still
   blocks its own call until its task is terminal. The block exists to stop a
   second competing edit of the **same** artifact, not to serialize *different*
   artifacts — independent deliverables are different documents, so blocking them
   in parallel (via same-step emission) is correct. Concurrency comes from
   emitting together, never from removing the block.

## Rationale

The concurrency primitive already existed in the SDK and executor; the gap was
purely "will the model use it." So the fix belongs where the model decides —
tool shape and prompt/plan structure — not in a new runtime component. Batching
images removes the model from the loop for the most common multi-item case;
encoding parallelism in the plan removes the ambiguity that made plan execution
default to serial. Both are aligned with the repo's single-agent-first,
reuse-the-SDK, no-role-play rules.

## Consequences

- Cross-type concurrency (HTML + video + images) remains **model-influenced**: it
  depends on the model co-emitting the group in one step. Mitigations: explicit
  plan structure, strong execute-mode instructions, and image batching lowering
  the call count. Accepted for the demo phase; if it proves unreliable, the next
  step is a deterministic "execute this parallel group" affordance, not an
  always-on orchestrator.
- **Native `n` dropped.** N variations of one idea are now N prompts (N concurrent
  `generateImage` calls) instead of one provider-native `n`-batch. Minor
  cost/coherence trade-off (independent calls lose a shared seed batch),
  acceptable for demo; revisit if a coherent variation set is needed.
- No executor, persistence, or wire-protocol change. `generate_image`'s output
  gained `count` / `failed` (documented in
  `schemas/streaming/chat-uimessage-stream.md`); older persisted messages render
  unchanged.
- Rendering of the concurrent results is owned by ADR-0021 (lightweight cards +
  deferred bytes); this ADR only governs how they are produced.
- **Live todo progress during the blocking parallel step** is owned by ADR-0017's
  `todo_id` linkage: each deliverable tool (`write_file`/`edit_file`,
  `generate_image`, `generate_video`) echoes an optional `todo_id` in every
  yield, and the frontend joins each todo item to its task's streamed status so
  the todo list advances 1/3 → 2/3 → 3/3 while the step is still blocked (the
  model, blocked in the step, cannot update it between per-task completions). The
  division of labor: this ADR *produces* the deliverables concurrently, ADR-0017
  *reflects* their per-task completion in the todo list, ADR-0021 *renders* each
  card. The model still reconciles the canonical todo list with a final
  `update_todos` when the step returns.
