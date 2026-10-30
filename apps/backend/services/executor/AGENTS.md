# Executor service

TypeScript/Hono/Nitro + Workflow 5. Read the current
[durable execution decision](../../../../docs/ADR/durable-execution.md) for
ownership and failure semantics. No service-to-service source imports.

## Entry points

- `src/application/tasks/registry.ts`: supported task types and schemas.
- `src/api/http/routes/tasks.ts`: start/read/watch/cancel and caller authorization.
- `src/application/tasks/service.ts`: idempotency, lifecycle and completion.
- `src/application/tasks/notify.ts`: persisted progress and durable wakeups.
- `src/application/tasks/cleanup.ts`: durable compensation/recovery.
- `src/bootstrap/runtime.ts`: database checks, World start and recovery.
- `src/dev.ts` / `scripts/build-workflows.ts`: local runtime/build entry;
  check the actual package script before changing development wiring.
- `workflows/`: Workflow orchestrators and steps.
- `src/application/video-production/`: durable video projection and approval.

## Runtime invariants

- Postgres World is required in configured deployments. Initialize its official
  schema before startup, then explicitly start World in bootstrap. Service data
  and Workflow execution data have separate ownership.
- Workflow 5 uses combined `/.well-known/workflow/v1/flow` plus webhook routes.
  Do not restore the old step handler.
- Keep Node-only imports, provider calls, database and HTTP I/O within
  `use step` boundaries; pass plain data through `use workflow` orchestration.
- Local development compiles workflows once then runs Hono via tsx. Restart after
  edits; watcher use is explicit. Production remains Nitro build/output.
- Check installed Nitro/Workflow types and production dependency tracing before
  upgrade changes; do not reapply obsolete OIDC patches from old plans.
- Same-database multi-step writes share one transaction. HTTP and Workflow start
  are external effects and remain outside it.

## State, progress and cancellation

- Task/projection tables are business truth. Workflow stream chunks are wakeups;
  the internal SSE route reloads snapshots and starts every connection with one.
- Completion is independently observed through the run return value; EOF is not
  completion. Consumers reconnect SSE without a task-wait polling fallback.
- Executor owns no browser UIMessage stream and never callbacks into Chat.
- Persist cancellation before cleanup. Workflow cancellation alone cannot cancel
  a provider job; long provider waits observe task cancellation and task types
  owning external durable state implement compensation. Cleanup failure must not
  resurrect the task.
- Classify `WorkflowRunCancelledError` separately from ordinary failure.
- Caller identity and authenticated tenant/workspace scope travel with every
  task. A caller-supplied owner ref or resource ID does not authorize access.

## File and media work

- File batches receive frozen shared context and independent complete-file
  instructions. Chat owns planning and publishes/discards the Knowledge change set.
- Knowledge processing calls Knowledge-owned convert/index commands; no foreign
  DB access. Canvas archive/frame workflows preserve Canvas domain ownership.
- Video approval binds to projection version. Paid create calls must not retry
  blindly after an ambiguous provider response. Persist provider IDs for cleanup.
- Stream large media through scratch files and Asset upload; don't buffer whole
  videos. ffmpeg is a deployment/local executable dependency.
- Task kinds are defined by the registry, not by old docs describing removed
  Canvas text/image/video task types.

## Verification

Run root `just test backend/executor`, affected caller tests and
`just build executor`; API changes additionally require `just sync`.
Real Workflow/DB checks cover duplicate/replayed notifications, terminal delivery,
approval recovery and cancellation compensation. Mocks cannot establish these
boundaries. Do not claim live checks based on historical ADR results.
