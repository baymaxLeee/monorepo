# ADR 0025: Cancellation is a persisted terminal state

## Status

Accepted. Amends ADR 0013 (resumable streams), ADR 0015 (executor tasks),
ADR 0017/0024 (todos), and ADR 0018 (video workflow).

## Context

An explicit user Stop already aborted the chat run and called
`WorkflowRun.cancel()` for a foreground executor task. That was not enough to
make cancellation a stable product state:

- AI SDK could persist a preliminary `tool-*` output such as
  `{ status: "running" }`. Reloading the conversation rendered that part as a
  live card even though its run was cancelled.
- `update_todos` was a completed tool call whose output could still contain
  `in_progress` items, so the latest injected todo context and the reloaded UI
  both described cancelled work as active.
- Executor cancellation marked the Workflow run terminal, but empirical
  inspection of run `wrun_01KWRAEVZHVDHKYV1EE9GTY3XV` showed three already
  active `waitSegmentStep` invocations completing 91–235 seconds after the run
  was marked cancelled. Workflow cancellation stops orchestration; it is not a
  provider-specific compensation protocol.
- Ark video jobs had no cancellation call even though Ark provides
  `DELETE /api/v3/contents/generations/tasks/{id}`.

The official AI SDK terminal state for an interrupted tool call is
`output-error`. A new custom stream part would duplicate that native state and
would create a second source of truth.

## Decision

Explicit Stop is a two-layer terminal transition:

1. **Execution cancellation.** Chat aborts its server-owned run signal. Durable
   tools request executor task cancellation. Executor immediately persists and
   notifies `cancelled`, cancels the Workflow run, and invokes an idempotent
   task-type compensation hook. Video records every Ark task id in the existing
   task progress JSON and deletes unfinished Ark jobs on cancellation. HTML
   records its Knowledge generation id there and marks that generation
   cancelled. Active video polling steps also observe executor cancellation and
   stop instead of waiting for the provider result.
2. **Transcript finalization.** Before persisting an aborted assistant
   UIMessage, chat converts every non-terminal/preliminary official tool part to
   `output-error` with `已取消。`. Successful terminal parts remain successful.
   The latest `update_todos` snapshot converts every non-completed item to
   `cancelled`; the matching trace output is updated as well so model context
   and transcript share one state.

The authenticated cancel endpoint waits for the local run finalizer before it
returns. The browser then reloads the persisted conversation. Route navigation
still only detaches the subscriber and never performs either terminal
transition.

## Consequences

- Reloading after explicit Stop cannot resurrect HTML/image/video/tool cards or
  todos as loading.
- Completed deliverables remain completed; only unfinished work is cancelled.
- Executor progress remains the existing `{ done, total }` public shape. Its
  JSON value may additionally carry private compensation references; chat
  notifications continue projecting only the public counter.
- Compensation is best effort after the durable local state is cancelled.
  Provider cleanup failures are logged and never turn the task back into
  running.
- No custom UIMessage data part, compatibility branch, or new database
  migration is introduced.

## References

- Bundled AI SDK v7 docs and `UIMessagePart` types: tool states terminate at
  `output-available`, `output-error`, or `output-denied`.
- Workflow DevKit `run.cancel()` and `WorkflowRunCancelledError` documentation.
- Ark `DeleteContentsGenerationsTasks` official API.
