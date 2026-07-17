# ADR 0024: Deliverable-tagged live todo completion

## Status

Accepted. Supersedes, in part, the "the model reconciles the todo snapshot only
after the parallel tool step returns" position of ADR 0017 (todo list), ADR 0022
(parallel deliverable execution), and ADR 0023 (tool contracts, decision point
8). Builds on ADR 0011 (ToolLoopAgent core) and ADR 0021 (lightweight media
cards). Does not change the executor contract (ADR 0015) or the video workflow
(ADR 0018).

## Context

A single task routinely dispatches html + images + video **concurrently in one
step** (ADR 0022). Re-examined from first principles against the running system,
that step has a hard, SDK-level property:

- `ToolLoopAgent` is created with `parallelToolCalls: true` (plan mode only
  filters plan writes that conflict with a same-step `ask_user`)
  (`services/chat/src/bootstrap/application/agent/agents/tool-loop.ts`). A step executes every tool
  call via `executeTools` → `await Promise.all(toolCalls.map(executeToolCall))`
  (`ai@7.0.15` `dist/index.js`), and `executeToolCall` consumes each tool's async
  generator **to its final yield** (`for await (... ) { ... }`). Intermediate
  yields fire `onPreliminaryToolResult` — this is what streams each deliverable
  card's live progress — but the *step* does not resolve, and the next model turn
  does not begin, until the **slowest** tool call returns.
- `generate_video` foreground-blocks on `waitForTaskTerminal` up to
  `MAX_TASK_WAIT_MS = 30 min` (`agent/tasks/executor-task.ts`); html blocks
  similarly; images finish in seconds.
- `update_todos` is model-driven (ADR 0017). The model can only call it *between*
  steps. ADR 0023 point 8 removed the deliverable→todo linkage, so the todo
  snapshot could only reconcile **after the whole parallel step returned**.

Net effect the user actually hit: images and html visibly complete (their cards
flip to done), but the todo card stays frozen with all items spinning until the
video — the slow pole — finishes, because that is the first moment the model
regains control to rewrite the list. The individual deliverable cards were live;
only the todo snapshot lagged, for the video's entire runtime.

Critically, co-emitting the video in the same blocking step buys almost no
wall-clock (total ≈ `max(video, html, images) ≈ video`); its only visible effect
was freezing the todo snapshot for minutes. The prior ADRs accepted "reconcile
after the step" because benchmark agents (Claude Code / Cursor) update todos at
step boundaries too — but their same-step parallel tools are all seconds-scale,
so the lag is invisible. It is not invisible when a 30-minute deliverable shares
the step.

## Decision

Re-introduce per-deliverable live todo completion, but as a **tag on the todo**,
not an id on the tool input (the coupling ADR 0023 rightly removed). Completion
is derived on the frontend from the deliverable cards that are already live —
the tool cards are the *fact* of "is this deliverable done"; the todo now
displays that fact instead of waiting for the model to restate it.

1. **`update_todos` items gain an optional `deliverable` tag** —
   `"artifact" | "image" | "video"`
   (`agent/tools/builtins/planning.ts`). The model tags each todo that is
   fulfilled by exactly one concurrent deliverable
   (`artifact` = write_file/edit_file, `image` = generate_images,
   `video` = generate_video). It is a static, self-descriptive label the model
   already knows at seed time — not a runtime tool-call id. Untagged todos keep
   the old fully model-driven behavior. There is **exactly one todo per
   deliverable**: the whole image batch (one `generate_images` call with multiple
   prompts) is a single `deliverable:"image"` todo, never one per image. The
   model seeds this list in a **standalone `update_todos` step** (no generation
   tool in the same step), marking the parallel deliverables `in_progress`, and
   only dispatches the html/image/video tools in the *next* step — so the full
   list renders as running before any deliverable card appears.

2. **The frontend advances tagged todos from the live tool parts.**
   `collectDeliverableCompletion(messages, latestTodoCallId)` scans the tool
   parts emitted **after** the latest `update_todos` part, groups them by
   `uiKind` (`image-gallery` / `video` / `artifact`), and derives each part's
   `running | completed | error | cancelled` state from the same parsers the
   cards use. `resolveTodoStatuses` **broadcasts** the single image batch state
   to every `deliverable:"image"` todo (a request is one batched call, so the
   batch is running while any part generates and completed once it lands — this
   also self-corrects if the model over-splits posters into several image todos),
   while `artifact`/`video` todos, being distinct documents, match by order. It
   **only ever upgrades** a todo (→ `completed` when its part is done,
   → `in_progress` when running, → `cancelled`/`failed` on the matching terminal
   state); it never downgrades a model-`completed` todo and leaves unmatched
   todos on the model status.
   (`apps/frontend/apps/chat/src/components/ChatTodoListCard.tsx`, threaded via
   `Chat.tsx` → `ChatMessageView.tsx`.)

3. **The model snapshot stays the source of truth.** The override is
   presentational and only fills the *in-step* gap: as soon as the run ends and
   the model issues its final `update_todos`, that snapshot (all items
   `completed`) becomes canonical, the deliverable parts sit before it, and no
   override applies — reload and live render agree. The `deliverable` tag stays
   in persisted UIMessage tool output and, if pruning removes that output while
   work is unfinished, in the bounded `<current_todo_snapshot>` historical
   replacement (ADR-0041).

4. **No new wire part, no executor change, no re-entry.** This reuses the
   existing official `tool-*` parts (their `uiKind` metadata and typed outputs)
   and the already-live streaming; `update_todos` remains a stateless,
   side-effect-free validation tool. Foreground-blocking (ADR 0015) and the
   video workflow (ADR 0018) are untouched.

## Rationale

The three constraints — SDK `Promise.all` step-blocking, model-driven todos, and
a co-blocked long-pole video — are mutually exclusive with "each todo updates as
its deliverable finishes." Something had to give. The options were: sequence the
video into a later step (prompt-only, but loses nothing except adds the fast
group's seconds to the video's start and is still model-behavior-dependent);
background the video with durable re-entry (reverses ADR 0015, needs a re-entry
trigger the chat runtime deliberately does not model); or let the todo display
derive from the deliverable cards that are *already* live. The third is the
smallest, most robust change and the only one that gives true per-deliverable
independence without touching the executor or the blocking contract.

Tagging the todo (vs. the old `todo_id` on the tool input) is a strictly better
shape: the tool inputs stay clean, the label is static and model-friendly, and
the matching lives entirely in the presentation layer. The tool card remains the
single fact source for completion; the todo stops being a second, lagging
opinion.

## Consequences

- html / images / video todos now flip independently, the instant each
  deliverable's card completes, even while the others (notably a multi-minute
  video) are still running. This is the behavior ADR 0017/0022/0023 had
  explicitly deferred.
- Images are one batched call → their todo is a single broadcast target, so even
  a mis-tagged over-split (three poster todos, one gallery) shows all three
  flipping together. `artifact`/`video` match by document order; a mismatch only
  mis-times a purely presentational upgrade and self-heals on the model's final
  reconcile.
- Persisted/older messages render correctly: on reload the deliverable parts are
  terminal, so derivation yields the same completed state the model reconciled.
- No schema/migration/route/wire-part change. `update_todos` output simply gained
  an optional field; older persisted todo parts (no tag) render exactly as
  before.

## References

Verified on 2026-07-05:

- `ai@7.0.15` `dist/index.js`: `executeTools` (`await Promise.all(...)`) and
  `executeToolCall` (`for await` over the tool stream; `preliminary` yields →
  `onPreliminaryToolResult`) — the step waits for the slowest tool call.
- ADR 0017 (stateless todo list), ADR 0022 (parallel deliverable execution),
  ADR 0023 point 8 (removed `todo_id`) — the positions this ADR supersedes.
- ADR 0021 (lightweight media cards) — owns how the concurrently produced
  deliverables render; this ADR only reads their live state.
