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
  and **no** outbound push on executor (ADR-0035 removed the old
  executor→chat notify): the owner polls `GET /tasks/:id` and decides how to
  surface progress to a browser. Keep it that way: a task's business shape stays
  a plain snapshot here, streaming/replay stays the owner's concern.
- Progress: a task's `progress` column is a `{ done, total }` counter the
  workflow reports per completed unit of work (see `reportTaskProgress` in
  `src/application/tasks/notify.ts`, called from `reportProgressStep` in the workflow). It
  is written to the DB and read by the owner's `GET /tasks/:id` poll (chat
  surfaces it as preliminary tool-results on the main useChat stream). It is
  best-effort UI sugar, never a correctness signal.
- `owner_service` + `owner_ref` is the task-row idempotency key. It does not make
  Workflow `start()` itself idempotent. A Workflow start failure marks the
  inserted row failed immediately; callers must not automatically start a
  second Workflow under the same user-visible tool call.
- Task execution durability comes from `workflow` (Workflow DevKit), not
  from this service's own process. `reconcilePendingTasks()` re-attaches to
  any `running` task's workflow run on every boot — safe to call every time,
  it replays against the durable run rather than re-executing anything.
- Business truth (who started what, for what, is it done) lives in this
  service's own PostgreSQL `tasks` table. Execution truth (steps, retries, replay)
  lives in the Workflow World (self-hosted Postgres via
  `@workflow/world-postgres`). **Dev/prod parity is an explicit product
  decision here**: local dev runs the same `postgres` container as
  every deployed environment (`docker-compose.yml`'s `postgres`
  service, started by `just up`) rather than defaulting to the
  filesystem-backed Local World — see "Known operational notes" #3, which
  this parity choice is what actually surfaced. Local World still exists as
  a fallback (comment out `WORKFLOW_TARGET_WORLD`/`WORKFLOW_POSTGRES_URL` in
  `.env` to use it, e.g. to work offline from Docker) but is not the default.

## TaskType registry

The authenticated `POST /html-validations` endpoint runs canonical static
checks first. Static hard errors return immediately; only a statically valid
artifact receives one whole-artifact model review. Model findings are
non-blocking, evidence-backed advisories and never change the report's `ok`
state. The endpoint owns final classification and returns the canonical compact
`{ ok, content_sha256, errors, advisories }` decision; callers must not
reinterpret raw findings. It is the post-generation quality tool and is never
called inside the HTML artifact workflow; durable Workflow remains reserved for
generation.

- `src/application/tasks/registry.ts` maps a `type` string to a Zod input schema and a
  `"use workflow"` function. This is the seam a future `harness`-backed
  execution engine plugs into: the registry and the HTTP layer never depend
  on how a task actually executes.
- Adding a new task type: define its `workflows/<name>.ts` (with `"use step"`
  functions for the actual work) and register it in `src/application/tasks/registry.ts`.
  Do not put business logic directly in `src/api/http/routes/tasks.ts` or
  `src/application/tasks/service.ts` — those stay type-agnostic.
- `echo` is a smoke-test type only. `html-artifact` (migrating
  `chat`'s `agent/artifacts/*` worker/lease/poll code here) is the first real
  type — see Phase 2 of the plan.
- `video-generation` is a durable **script -> storyboard -> per-segment
  create/poll -> ffmpeg-assemble** workflow for vertical short-drama (see
  ADR-0018): `planStep` runs Stage A `planScript` (`src/application/video/script.ts`, text
  provider) then Stage B `planSegments` (`src/application/video/storyboard.ts`) plus a
  best-effort `generateCharacterSheet` (optional image provider) ->
  `createSegmentStep`/`waitSegmentStep` (Ark create + poll) ->
  `assembleStep` (`src/application/video/assembler.ts`). Clip URLs are the durable step state
  (bytes never cross a step boundary). It needs the **ffmpeg** OS binary (see
  operational note #6) and three providers threaded from chat's `catalog.ts`
  (video + text-required + optional image).
  - **ONE segment == ONE story beat == ONE Seedance generation == ONE continuous,
    single-take action.** We do NOT subdivide a segment into multiple in-prompt
    shots/timecodes: a beat is one event, and asking the model to "cover" it from
    several angles in one generation is what produced **块内剧情重复** (the same
    moment re-shot). Cut density comes from MORE short segments hard-cut at
    assembly (Seedance renders a single take per generation; true cuts = concat).
  - **Length is deterministic: segment count = 秒数 / 12** (`deriveSegmentCount` in
    `src/application/video/limits.ts`), each segment ~12s (sweet spot; `ark.ts` clamps to
    the real integer 4–15 range). The pipeline always sends an explicit integer
    `duration` in EVERY mode including reference mode (the official 2.x API
    accepts it — there is no "strip duration in reference mode" case).
  - **Anti-repetition is the script's job, in two layers**: `planScript` writes
    exactly N DISTINCT beats; `dedupeBeats` drops near-duplicates and, if the
    model still collapsed the sheet, swaps in a deterministic DISTINCT dramatic
    arc built from the same characters. Within-segment repetition is structurally
    impossible (one action per segment).
  - **Reliability**: Ark create is a paid side effect without a provider
    idempotency key, so `createSegmentStep.maxRetries = 0`; 4xx, 429, 5xx, and
    network errors become that segment's structured failure instead of silently
    creating another task. The pre-assembly completion gate requires every user-supplied
    `segments[]` entry. Auto-planned reels may degrade only to a contiguous
    successful prefix starting at the hook: multi-segment reels require ≥60%
    (≥2 segments), while a single-segment one-shot passes when that clip succeeds.
    Later successes after a failed segment are not assembled across the plot hole.
  - **Assembly is hard-cut ONLY, always parallel.** Every segment references the
    character sheet and fans out via `mapConcurrent` with
    `VIDEO_SEGMENT_CONCURRENCY` (default 12, matching the max segment count), then
    concatenates with hard cuts. Seed is per-segment derived (soft reproducibility
    on 2.x). There is NO serial/seamless mode: the `continuity: "chain"` option
    (last-frame → next first-frame chaining) was removed — it was serial, so an
    N-segment reel took ≈N × per-segment render time and blew past chat's 30-min
    `waitForTaskTerminal` cap, getting the task cancelled (see ADR-0018 final
    update). Do NOT reintroduce chaining, `return_last_frame`, `first_frame`
    segment input, or any `continuity` knob.
  - Do NOT reintroduce multi-shot-per-segment prompting, in-prompt timecodes, or a
    fixed `seconds`/`duration` admin default without re-reading ADR-0018.

## Boundaries

- No direct imports from `chat`, `knowledge`, or `admin`. Calls to those
  services go through `@backend/transport-ts`, called from inside
  `"use step"` functions (workflow sandbox functions must not statically
  import Node-only dependencies — see Workflow DevKit's directive docs).
- `chat` calls this service through `@backend/transport-ts`'s
  `ExecutorInternalClient`; it never imports this service's source.
- This service owns no chat/artifact domain concepts (conversation, message,
  document). It only knows about tasks, types, and payloads.
- DB transactions (ADR-0037): same-DB multi-step writes use
  `getDb().transaction(async (tx) => ...)` (as `tasks/notify.ts` already does);
  Workflow starts / HTTP calls are external side effects and stay OUTSIDE the tx.

## Outbound task notifications

- **Removed (ADR-0035).** Executor no longer pushes task events to any owner.
  There is no `POST /internal/tasks/notify` call, no `ChatInternalClient`, and
  no `src/infrastructure/clients/chat.ts`. The owner (chat) polls `GET /tasks/:id` and reads the
  `progress`/`status`/`result` columns; `reportTaskProgress` still writes
  `tasks.progress` for that poll to read. Do not reintroduce an outbound push —
  progress belongs on the owner's own stream (chat surfaces it as preliminary
  tool-results on the main useChat stream).

## Entry points

- `nitro.config.ts` — Nitro + `workflow/nitro` build config; routes `/**` to
  `src/index.ts`.
- `src/index.ts` — Nitro-mounted Hono app entry + boot-time task reconciler.
- `src/app.ts` — route wiring, auth, error mapping.
- `src/api/http/routes/tasks.ts` — Task API (start/get/cancel).
- `src/application/tasks/service.ts` — task lifecycle, idempotency, completion watching.
- `src/application/tasks/notify.ts` — progress recording into `tasks.progress` (no push).
- `src/application/tasks/registry.ts` — TaskType registry.
- `workflows/*.ts` — one file per TaskType's actual `"use workflow"`/`"use step"`
  implementation.

## Known operational notes (Nitro v3 beta / Workflow World gotchas)

All fixed, all re-check-worthy whenever `nitro`/`workflow`/`ai` are bumped:

1. **`nf3`/`@vercel/nft` ESM interop bug** used to break `nitro build`'s
   production server bundling (`Named export 'nodeFileTrace' not found`).
   **Fixed upstream in `nf3@0.3.19`** — it ships the same default-import
   destructure we used to `pnpm patch` into 0.3.18. The local patch and its
   `patchedDependencies` entry are **gone**; `nf3` is pinned to `0.3.19` via
   `overrides` in `apps/backend/pnpm-workspace.yaml` (nitro only requires
   `^0.3.17`, so without the pin pnpm could resolve back to the broken 0.3.18).
   Because there is no longer a workspace patch, backend `Dockerfile`s no longer
   need to `COPY apps/backend/patches` before `pnpm install`. If a future
   `nitro`/`nf3` bump reintroduces the bug, `pnpm patch nf3@<version>` (default
   import + destructure) is the fallback — but check upstream first. Drop the
   `overrides` pin once nitro's own floor moves past 0.3.19.
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
   against a real `postgres` container (`workflow.workflow_runs`
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
   once: calling `buildSegmentContent` (exported from `storyboard.ts`, which
   imports `ai`/`ark`) inside the `mapConcurrent` worker pulled `ai` into the
   orchestrator chunk. Fix: compose segment prompts **inside**
   `createSegmentStep`, so every Node-touching import is reachable only from a
   `"use step"` body. Pass plain data (segment, script) across the step boundary,
   never call a Node-touching helper from the orchestrator. Pure numeric planning
   constants/helpers live in `src/application/video/limits.ts` (no `ai`/Node import) so both
   the orchestrator and the steps can import them safely.

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

`run.cancel()` makes the Workflow run terminal and prevents new orchestration,
but it is not a provider-specific compensation protocol. Empirical inspection
of a cancelled video run showed already-running `use step` polls continuing
after the run became `cancelled`. Every long provider call therefore combines
its normal timeout with `observeTaskCancellation()`; every task type that owns
external durable state registers a `cancel` hook. Video records Ark task ids and
DELETEs them; HTML records and cancels the Knowledge generation. Cancellation
state is persisted before cleanup, and cleanup failures are logged without
resurrecting the task.

`run.returnValue` rejects with `WorkflowRunCancelledError` (from
`"workflow/errors"`), not a generic `AbortError`; `watchCompletion()` still
uses `WorkflowRunCancelledError.is(error)` for classification.

Run from `apps/backend`: `just lint executor`, `just build executor`,
`just gen-openapi executor`.
