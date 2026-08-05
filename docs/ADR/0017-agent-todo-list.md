# ADR 0017: Stateless todo-list tool for the tool-loop agent

## Status

Accepted. Complements ADR 0011 and ADR 0012; does not supersede either. ADR 0050
removes the historical plan-specific write tools described below.

## Context

`691fd33` introduced a fully structured `PlanSnapshot` (stable item IDs,
`revision`, `pending/in_progress/completed/failed/skipped` status,
`dependsOn`, `result` refs) plus a dedicated `ChatPlanCard`. One day later,
`05d69f2` deleted both and replaced `update_plan` with the current Markdown
plan artifact (`apps/backend/services/chat/src/application/agent/plans/service.ts`):
`write_plan`/`update_plan` persist a `*-plan.md` document in knowledge with a
compare-and-swap `revision_id = document.updated_at`, and the only UI is the
generic `ArtifactDocumentCard`. That change kept ADR 0012's principle of one
truth source per concern, but it also removed any visible, structured,
per-step progress indicator — the plan's `## 任务` section is free-form prose
and nothing tracks which step is done while the agent executes.

ADR 0050 later replaced this create/update pair with plan-mode
`write_markdown`, which creates or fully overwrites the same Markdown document
without changing the plan-versus-todo truth-source decision in this ADR.

Reintroducing the deleted `PlanSnapshot` verbatim would recreate exactly the
duplication ADR 0012 removed: the plan body would live in Markdown while
per-item state lived in a second JSON structure, and the two could drift
(stale item text, orphaned IDs after a plan edit). Industry precedent (Codex,
Claude Code, Cursor's own `TodoWrite`-style tool) treats the todo list
differently from the plan itself: it is a lightweight, disposable progress
tracker for the *current* execution, not a versioned document.

## Decision

- Add one new tool, `update_todos`
  (`apps/backend/services/chat/src/application/agent/tools/builtins/planning.ts`), available
  in both `normal` and `plan` mode tool catalogs
  (`apps/backend/services/chat/src/application/agent/tools/catalog.ts`).
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
  consume the selected Plan's latest complete `read_file` result and seed `update_todos` from that
  checklist before doing any other work, and to use `update_todos` generally
  for any 3+ step task, plan-derived or not.
- The frontend renders `tool-update_todos` output with the existing
  `Plan`/`PlanHeader`/`PlanContent`/`Task`/`TaskTitle` primitives
  (`apps/frontend/packages/ai-elements/src/AiChat/workflow.tsx`) inside the
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
- **Update (context design, superseded by ADR-0041):** persisted UIMessage tool
  parts are the Todo truth source. `projectModelContext` does not reconstruct or
  dynamically inject Todo business state; it applies only normal history pruning
  and compaction.
- The frontend applies a matching, purely presentational fix in
  `apps/frontend/apps/chat/src/pages/Chat.tsx` /
  `ChatMessageView.tsx`: only the `tool-update_todos` part with the latest
  `toolCallId` across the whole conversation renders a card; earlier ones
  render nothing. This does not touch what is sent to the model — it only
  stops the human-facing transcript from showing one card per update.
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
- **Update (single-item ban):** `update_todos` is for multi-item checklists only.
  A one-item list wrapping a single deliverable is always wrong (including
  multi-page HTML). The runtime contract and tool description hard-skip single
  deliverables; duration alone is not a reason — the deliverable tool card
  already shows progress. See ADR 0035.
