# ADR 0017: Stateless todo-list tool for the tool-loop agent

## Status

Accepted. Complements ADR 0011 and ADR 0012; does not supersede either.

## Context

`691fd33` introduced a fully structured `PlanSnapshot` (stable item IDs,
`revision`, `pending/in_progress/completed/failed/skipped` status,
`dependsOn`, `result` refs) plus a dedicated `ChatPlanCard`. One day later,
`05d69f2` deleted both and replaced `update_plan` with the current Markdown
plan artifact (`apps/backend/services/chat/src/agent/plans/service.ts`):
`write_plan`/`update_plan` persist a `*-plan.md` document in knowledge with a
compare-and-swap `revision_id = document.updated_at`, and the only UI is the
generic `ArtifactDocumentCard`. That change kept ADR 0012's principle of one
truth source per concern, but it also removed any visible, structured,
per-step progress indicator — the plan's `## 任务` section is free-form prose
and nothing tracks which step is done while the agent executes.

Reintroducing the deleted `PlanSnapshot` verbatim would recreate exactly the
duplication ADR 0012 removed: the plan body would live in Markdown while
per-item state lived in a second JSON structure, and the two could drift
(stale item text, orphaned IDs after a plan edit). Industry precedent (Codex,
Claude Code, Cursor's own `TodoWrite`-style tool) treats the todo list
differently from the plan itself: it is a lightweight, disposable progress
tracker for the *current* execution, not a versioned document.

## Decision

- Add one new tool, `update_todos`
  (`apps/backend/services/chat/src/agent/tools/builtins/planning.ts`), available
  in both `normal` and `plan` mode tool catalogs
  (`apps/backend/services/chat/src/agent/tools/catalog.ts`).
- The tool takes `{ todos: [{ id, content, status }] }` and always replaces
  the whole list; `status` is `pending | in_progress | completed`, matching
  Claude Code's `TodoWrite` exactly. `execute` is a pure validation function:
  no knowledge writes, no database rows, no `contextSchema`.
- There is no revision/CAS and no separate truth source. State lives only in
  the native UIMessage `tool-update_todos` parts already persisted by the
  existing message-parts pipeline, the same mechanism every other tool output
  uses.
- Plan mode's `## 任务` section must be written as a Markdown checklist
  (`- [ ] ...`) so it can be mechanically carried into a todo list once the
  user starts execution. Normal mode's instructions tell the model to call
  `read_file` on a `<referenced_plan>` and seed `update_todos` from that
  checklist before doing any other work, and to use `update_todos` generally
  for any 3+ step task, plan-derived or not.
- The frontend renders `tool-update_todos` output with the existing
  `Plan`/`PlanHeader`/`PlanContent`/`Task`/`TaskTitle` primitives
  (`apps/frontend/packages/components/src/AiChat/workflow.tsx`) inside the
  same collapsible `Tool` shell every other tool call uses — no new
  collapse/dedup logic, no cross-message state.

## Rationale

The plan Markdown document and the todo list answer different questions: the
plan document is "what should be done and why", reviewable and editable by
the user; the todo list is "what has the agent actually finished right now",
ephemeral to one execution pass. Collapsing them back into one structure is
what caused the original `PlanSnapshot` to need revision/CAS machinery in the
first place. Keeping `update_todos` stateless and side-effect-free means it
needs no migration, no new endpoint, and cannot itself become a second
source of truth for plan content.

## Consequences

- No database schema change; no new HTTP route.
- Because `update_todos` is a normal tool call, its history is visible and
  inspectable like any other tool part.
- **Update (context design):** the gap noted in the original version of this
  ADR — nothing recovered "the current todo list" across a
  context-compaction or pruning boundary — is closed.
  `apps/backend/services/chat/src/agent/context/projector.ts`'s
  `projectModelContext` now always looks up
  `latestCompletedToolOutput(conversationId, "update_todos")` and, when
  present, injects it as `<current_todo_list>` in `instructionContext` on
  every turn, independent of `pruneMessages({ toolCalls:
  "before-last-2-messages" })` and independent of whether the conversation
  has triggered summary compaction yet. This matters because `update_todos`
  has no read-back tool, unlike `read_file`/`web_search`/knowledge search,
  whose outputs the generic prune pass can safely drop because the model can
  re-fetch them — dropping the *only* copy of the todo state is not
  recoverable the same way. This mirrors, at a much smaller scale, why
  Claude Code moved `TodoWrite` (an in-context, full-list-replace tool with
  the same failure mode) to a persistent `TaskCreate`/`TaskUpdate`/`TaskGet`
  API in 2026 — the fix here reuses the existing trace table and
  `<conversation_state>`-style reinjection instead of adding a new storage
  layer or query tool, since the todo list is small and already recorded.
- The frontend applies a matching, purely presentational fix in
  `apps/frontend/apps/chat/src/pages/Chat.tsx` /
  `ChatMessageView.tsx`: only the `tool-update_todos` part with the latest
  `toolCallId` across the whole conversation renders a card; earlier ones
  render nothing. This does not touch what is sent to the model — it only
  stops the human-facing transcript from showing one card per update.
- `apps/backend/services/chat/.doc/artifact-plan-todolist.md` remains a
  historical reference for the abandoned `PlanSnapshot` design; it is not
  reactivated by this ADR.
- **Update (concurrent execution):** the original "at most
  one item in_progress" cap was dropped (both the `update_todos` validation and
  its tool description). When several independent deliverables are dispatched in
  one foreground-blocking step (ADR 0022), they run concurrently and must all
  show `in_progress`; capping it to one forced the model into an artificial
  serial order — it visibly agonized over the "system doesn't allow more than
  one in_progress" contradiction and marked only one. Multiple in_progress
  matches parallel task execution. ADR 0023 removes the cross-domain `todo_id`
  linkage from artifact and media inputs. Each tool card owns its live progress;
  after the parallel step returns, the model reconciles the canonical todo list
  with one `update_todos` call.
- **Update (live per-deliverable completion, ADR 0024):** the "reconcile only
  after the parallel step returns" behavior above is superseded. Todo items now
  carry an optional `deliverable` tag (`artifact`/`image`/`video`); the frontend
  advances each tagged todo the instant its own deliverable card completes, so
  html/images/video update independently instead of all waiting for the slowest
  (a multi-minute video). The tag replaces the removed `todo_id` coupling with a
  static label on the todo, and the model snapshot remains the source of truth.
  See ADR 0024.
