# executor service (TypeScript)

Durable task executor. It is the "Hands + Session" half of the chat agent's
tool-loop + workflow combination: `chat`'s `ToolLoopAgent` (the "Brain")
delegates any long-running, must-survive-process-loss unit of work to this
service instead of running it inline. See
`docs/ADR/0015-agent-task-executor.md` and the `agent_task_执行时服务` plan
for the full rationale.

## Runtime contract

- One `POST /tasks` starts exactly one durable `workflow` run and returns
  immediately (`status: "queued"` or `"running"`). Callers never block an
  HTTP request on task completion; they poll `GET /tasks/:id`. There is no
  `GET /tasks/:id/stream` — it was cut as speculative (no real caller ever
  used it); add a real streaming endpoint only once a concrete consumer
  needs sub-poll-interval progress, with a defined chunk shape from day one.
- `owner_service` + `owner_ref` is the idempotency key. Retrying a start
  request with the same pair returns the existing task, never starts a
  second workflow run.
- Task execution durability comes from `workflow` (Workflow DevKit), not
  from this service's own process. `reconcilePendingTasks()` re-attaches to
  any `running` task's workflow run on every boot — safe to call every time,
  it replays against the durable run rather than re-executing anything.
- Business truth (who started what, for what, is it done) lives in this
  service's own MySQL `tasks` table. Execution truth (steps, retries, replay)
  lives in the Workflow World (self-hosted Postgres in every deployed
  environment via `@workflow/world-postgres`; local dev defaults to the
  filesystem-backed Local World when `WORKFLOW_TARGET_WORLD` is unset).

## TaskType registry

- `src/tasks/registry.ts` maps a `type` string to a Zod input schema and a
  `"use workflow"` function. This is the seam a future `harness`-backed
  execution engine plugs into: the registry and the HTTP layer never depend
  on how a task actually executes.
- Adding a new task type: define its `workflows/<name>.ts` (with `"use step"`
  functions for the actual work) and register it in `src/tasks/registry.ts`.
  Do not put business logic directly in `src/routes/tasks.ts` or
  `src/tasks/service.ts` — those stay type-agnostic.
- `echo` is a smoke-test type only. `html-artifact` (migrating
  `chat`'s `agent/artifacts/*` worker/lease/poll code here) is the first real
  type — see Phase 2 of the plan.

## Boundaries

- No direct imports from `chat`, `knowledge`, or `admin`. Calls to those
  services go through `@backend/transport-ts`, called from inside
  `"use step"` functions (workflow sandbox functions must not statically
  import Node-only dependencies — see Workflow DevKit's directive docs).
- `chat` calls this service through `@backend/transport-ts`'s
  `ExecutorInternalClient`; it never imports this service's source.
- This service owns no chat/artifact domain concepts (conversation, message,
  document). It only knows about tasks, types, and payloads.

## Entry points

- `nitro.config.ts` — Nitro + `workflow/nitro` build config; routes `/**` to
  `src/index.ts`.
- `src/index.ts` — Nitro-mounted Hono app entry + boot-time task reconciler.
- `src/app.ts` — route wiring, auth, error mapping.
- `src/routes/tasks.ts` — Task API (start/get/cancel/stream).
- `src/tasks/service.ts` — task lifecycle, idempotency, completion watching.
- `src/tasks/registry.ts` — TaskType registry.
- `workflows/*.ts` — one file per TaskType's actual `"use workflow"`/`"use step"`
  implementation.

## Known operational notes (Nitro v3 beta tracer bugs)

Both fixed, both re-check-worthy whenever `nitro`/`workflow`/`ai` are bumped:

1. **`nf3`/`@vercel/nft` ESM interop bug** breaks `nitro build`'s production
   server bundling (`Named export 'nodeFileTrace' not found`). Fixed via
   `apps/backend/patches/nf3@0.3.18.patch` (`pnpm patch`).
2. **`nf3` path-depth bug**: `ai`/`@ai-sdk/gateway` pull in `@vercel/oidc`
   (never actually called — this service only uses `createOpenAICompatible`
   directly), and nf3 miscalculates the number of `../` segments when
   copying that file into `.output` for a package nested this deep in the
   monorepo, crashing at boot with `MODULE_NOT_FOUND`. Fixed via
   `scripts/fix-oidc-trace.mjs`, wired as the `postbuild` step of
   `pnpm run build` — always runs automatically, no manual step needed.

Validated end to end (Phase 2 of the plan): a real `html-artifact` task ran
through `planStep` → `generateBlockStep` × N → `compileAndPublishStep` against
a real provider and produced a real published document.

## Cancellation

`run.cancel()` resolves in low single-digit seconds even mid-step in testing
— Workflow DevKit's own cancellation is not merely "stop scheduling new
steps," it interrupts promptly. There is no custom AbortSignal-forwarding
code here, and none should be added speculatively: verify with a real
cancellation test (see the plan's Phase 5 notes) before assuming a gap
exists. The one real bug found here was classification, not latency:
`run.returnValue` rejects with `WorkflowRunCancelledError` (from
`"workflow/errors"`), not a generic `AbortError` — `watchCompletion()` in
`src/tasks/service.ts` checks `WorkflowRunCancelledError.is(error)`.

Run from `apps/backend`: `just lint executor`, `just build executor`,
`just gen-openapi executor`.
