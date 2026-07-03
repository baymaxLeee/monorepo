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
  HTTP request on task completion. `GET /tasks/:id` is the durable read
  (snapshot incl. `progress`). There is deliberately **no** streaming endpoint
  on executor — instead executor *pushes* events to the owning service (see
  "Outbound task notifications"); the owner, not executor, decides how to
  surface them to a browser. Keep it that way: a task's business shape stays a
  plain snapshot here, streaming/replay stays the owner's concern.
- Progress: a task's `progress` column is a `{ done, total }` counter the
  workflow reports per completed unit of work (see `reportTaskProgress` in
  `src/tasks/notify.ts`, called from `reportProgressStep` in the workflow). It
  is best-effort UI sugar, never a correctness signal.
- `owner_service` + `owner_ref` is the idempotency key. Retrying a start
  request with the same pair returns the existing task, never starts a
  second workflow run.
- Task execution durability comes from `workflow` (Workflow DevKit), not
  from this service's own process. `reconcilePendingTasks()` re-attaches to
  any `running` task's workflow run on every boot — safe to call every time,
  it replays against the durable run rather than re-executing anything.
- Business truth (who started what, for what, is it done) lives in this
  service's own MySQL `tasks` table. Execution truth (steps, retries, replay)
  lives in the Workflow World (self-hosted Postgres via
  `@workflow/world-postgres`). **Dev/prod parity is an explicit product
  decision here**: local dev runs the same `workflow-postgres` container as
  every deployed environment (`docker-compose.yml`'s `workflow-postgres`
  service, started by `just up`) rather than defaulting to the
  filesystem-backed Local World — see "Known operational notes" #3, which
  this parity choice is what actually surfaced. Local World still exists as
  a fallback (comment out `WORKFLOW_TARGET_WORLD`/`WORKFLOW_POSTGRES_URL` in
  `.env` to use it, e.g. to work offline from Docker) but is not the default.

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
- `video-generation` is a durable **plan -> concurrent-scene -> ffmpeg-assemble**
  workflow for vertical short-drama (see ADR-0018): `planStep`
  (`src/video/storyboard.ts`, text provider) -> `createSceneStep`/`waitSceneStep`
  fanned out via `mapConcurrent` -> `assembleStep` (`src/video/assembler.ts`).
  Clip URLs are the durable step state (bytes never cross a step boundary); a
  failed scene degrades and is skipped at assembly. It needs the **ffmpeg** OS
  binary (see operational note #6) and three providers threaded from chat's
  `catalog.ts` (video + text-required + optional image).
  - **Per-clip length is a 4–8s window (4s is Seedance's hard minimum; upper
    bound 8s), below Seedance's 4–15s range, on purpose**: single-prompt clips
    longer than ~8s hit *temporal decay*
    and produce looping / near-duplicate frames (the "镜头重复" bug). The planner
    (`storyboard.ts`) is a 分镜师 that decides a VARIABLE shot count and a VARIABLE
    per-shot duration from narrative beats — cut density comes from MORE hard-cut
    scenes, never a longer clip — and enforces "one continuous action + one camera
    move per scene". Do not raise `CLIP_SECONDS_MAX` or reintroduce
    multi-shot-per-clip prompting without re-reading ADR-0018.

## Boundaries

- No direct imports from `chat`, `knowledge`, or `admin`. Calls to those
  services go through `@backend/transport-ts`, called from inside
  `"use step"` functions (workflow sandbox functions must not statically
  import Node-only dependencies — see Workflow DevKit's directive docs).
- `chat` calls this service through `@backend/transport-ts`'s
  `ExecutorInternalClient`; it never imports this service's source.
- This service owns no chat/artifact domain concepts (conversation, message,
  document). It only knows about tasks, types, and payloads.

## Outbound task notifications

- On every progress update and on the terminal transition, executor fires a
  fire-and-forget `POST /internal/tasks/notify` at the owning service
  (`ChatInternalClient.notifyTaskEvent` via `@backend/transport-ts`, base URL
  `CHAT_SERVICE_URL`). This is the reverse of chat's `EXECUTOR_SERVICE_URL`.
- It is **best-effort by contract**: a failed/dropped notification is logged
  and swallowed, never fails or slows a task. The durable truth is always
  `GET /tasks/:id`; the notification only saves the owner a poll. Today the
  only owner is `chat` (routed by `conversationId` on the task payload); a
  task with no known owner/route is simply not notified.
- Routing keys ride on the task payload (chat puts `conversationId` there).
  Executor does not model owner-specific concepts beyond reading that key.

## Entry points

- `nitro.config.ts` — Nitro + `workflow/nitro` build config; routes `/**` to
  `src/index.ts`.
- `src/index.ts` — Nitro-mounted Hono app entry + boot-time task reconciler.
- `src/app.ts` — route wiring, auth, error mapping.
- `src/routes/tasks.ts` — Task API (start/get/cancel).
- `src/tasks/service.ts` — task lifecycle, idempotency, completion watching.
- `src/tasks/notify.ts` — progress recording + outbound owner notifications.
- `src/clients/chat.ts` — `notifyTaskEvent` wrapper over `ChatInternalClient`.
- `src/tasks/registry.ts` — TaskType registry.
- `workflows/*.ts` — one file per TaskType's actual `"use workflow"`/`"use step"`
  implementation.

## Known operational notes (Nitro v3 beta / Workflow World gotchas)

All fixed, all re-check-worthy whenever `nitro`/`workflow`/`ai` are bumped:

1. **`nf3`/`@vercel/nft` ESM interop bug** breaks `nitro build`'s production
   server bundling (`Named export 'nodeFileTrace' not found`). Fixed via
   `apps/backend/patches/nf3@0.3.18.patch` (`pnpm patch`). This patch is
   registered in `apps/backend/pnpm-workspace.yaml`'s `patchedDependencies`,
   which is workspace-wide: **any** backend service's `Dockerfile` running
   `pnpm install` there must `COPY apps/backend/patches ./apps/backend/patches`
   before it, even if that service never depends on `nf3` — otherwise pnpm
   fails with `ENOENT ... patches/nf3@0.3.18.patch` while hashing the
   lockfile, regardless of `--filter`. Bit `chat`'s Dockerfile once (fixed
   by adding the same `COPY` there); re-check this for every new service.
2. **`nf3` path-depth bug**: `ai`/`@ai-sdk/gateway` pull in `@vercel/oidc`
   (never actually called — this service only uses `createOpenAICompatible`
   directly), and nf3 miscalculates the number of `../` segments when
   copying that file into `.output` for a package nested this deep in the
   monorepo, crashing at boot with `MODULE_NOT_FOUND`. Fixed via
   `scripts/fix-oidc-trace.mjs`, wired as the `postbuild` step of
   `pnpm run build` — always runs automatically, no manual step needed.
3. **`nitro/~internal/runtime/plugin` isn't exported** by
   `nitro@3.0.260610-beta` (checked: it's absent from the package's own
   `exports` map), so the Postgres World doc's official "Starting the World"
   Nitro-plugin example cannot be used as written. Worked around by calling
   `getWorld().start()` directly at module scope in `src/index.ts` instead —
   this is the same mechanism a Nitro plugin would trigger, it just doesn't
   go through Nitro's plugin system. This one matters more than the other
   two: without it, a deployment on the Postgres World would create workflow
   runs whose steps never advance (the docs are explicit that setting
   `WORKFLOW_TARGET_WORLD` alone does not start the graphile-worker queue
   that processes them) — silently, since `POST /tasks` still returns
   `"running"` immediately either way. Empirically verified end to end
   against a real `workflow-postgres` container (`workflow.workflow_runs`
   gained a row, `.workflow-data/` was never created, task reached
   `completed`) — this had never actually been tested before, only assumed
   from reading the docs.

4. **`nitro dev` auto-loads `.env`; the built server does not.** The Nitro
   dev watcher (now `pnpm dev:watch`) picks up `WORKFLOW_TARGET_WORLD` etc.
   from `.env` automatically — verified by dispatching a real task and
   confirming no `.workflow-data/` appeared. Running `node
   .output/server/index.mjs` directly does **not** load `.env` at all (also
   verified: same task, `.workflow-data/` did appear, meaning it silently fell
   back to Local World even with `.env` correctly configured). `package.json`'s
   `start` script is `node --env-file=.env .output/server/index.mjs`
   specifically to close this gap for the production build locally. This
   doesn't affect real deployments — `docker-compose.prod.yml`/k8s inject env
   vars directly, never through a `.env` file — but it matters for local
   testing: don't assume `.env` "just works" for every way of running this.

5. **Local dev runs the built server, not a watcher (no hot reload).** `pnpm
   dev` is `pnpm build && pnpm start` — a one-shot `nitro build` then the
   `--env-file` node run above. This is deliberate: `nitro dev`'s file watcher
   is expensive and, more importantly, returns HTTP **503/500** from its dev
   proxy for the seconds it takes to rebuild on every save — which surfaced as
   a `TransportError: executor request failed: 503` in chat once
   `write_file`/`edit_file` began foreground-polling `GET /tasks/:id` across a
   whole generation (chat now tolerates transient 5xx there, but the churn was
   still pointless). Edit executor code → restart the process to pick it up.
   Use `pnpm dev:watch` only if you specifically want the watcher back.

6. **`video-generation` needs ffmpeg, and the `"use workflow"` orchestrator
   must stay Node-module-free.** The Dockerfile installs `ffmpeg` via `apt`
   (deliberately not `ffmpeg-static` — a native binary would hit the same nft
   bundling class of bug as #1/#2); local dev needs it on PATH
   (`brew install ffmpeg`). `FFMPEG_PATH` overrides the binary. Separately: the
   Workflow DevKit build (`Discovering workflow directives`) **fails the whole
   `nitro build`** if the `"use workflow"` orchestrator — or any non-`"use step"`
   helper it calls — transitively imports a Node-dependent module (`node:net`
   via `provider-url`, the `ai` package, etc.). This bit `video-generation`
   once: calling `buildScenePrompt` (exported from `storyboard.ts`, which
   imports `ai`) inside the `mapConcurrent` worker pulled `ai` into the
   orchestrator chunk. Fix: compose scene prompts **inside** `createSceneStep`,
   so every Node-touching import is reachable only from a `"use step"` body.
   Pass plain data (scene, storyboard) across the step boundary, never call a
   Node-touching helper from the orchestrator.

Calling `getWorld().start()` is gated on `WORKFLOW_TARGET_WORLD` being set:
under the default Local World it throws `Invalid version string: "bundled"`
(caught, logged, harmless, but pointless noise on every local boot) —
empirically confirmed, not a documentation assumption.

Validated end to end (Phase 2 of the plan, and again for bugs 3-4 above): a
real `html-artifact` task ran through `planStep` → `generateBlockStep` × N →
`compileAndPublishStep` against a real provider and produced a real published
document, on both Local World and Postgres World, under `nitro dev`, plain
`node`, and `node --env-file`.

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
