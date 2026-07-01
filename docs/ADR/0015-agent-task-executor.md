# ADR 0015: A dedicated executor service for durable background agent tasks

## Status

Accepted.

## Context

[ADR-0011](0011-tool-loop-agent-core.md) settled the main chat run on
`ToolLoopAgent` and explicitly deferred the remaining gap: "A future
background job must introduce Workflow/queue infrastructure at that job
boundary, not wrap the core chat agent." [ADR-0012](0012-agent-file-tools.md)
then collapsed HTML artifact generation into a single `write_file` tool call
and explicitly accepted, as a known limitation, that "Active process loss
still cancels the run... remain for later product-level recovery work" — the
hand-rolled worker pool / lease / cancellation-poll code in
`chat/src/agent/artifacts/{worker,generation-runner}.ts` reliably survived a
single process's lifetime but not a crash or redeploy mid-generation.

Separately, the product direction shifted to explicitly target long-running,
large-task production (Cursor/Codex/Claude-Code-style background agents, not
just chat), which makes this gap the priority rather than a deferred nicety.

## Decision

1. **New service: `executor`** (`apps/backend/services/executor`). It is the
   "Hands + Session" half of the agent (chat's `ToolLoopAgent` remains the
   "Brain," entirely unchanged). It is a standalone deployable unit — chat
   never imports its source, only `@backend/transport-ts`'s
   `ExecutorInternalClient`.
2. **Real Workflow DevKit** (`workflow` + `@ai-sdk/workflow`), not a
   hand-rolled runtime. A Nitro + esbuild/rolldown spike proved the original
   ADR-0011/ADR-0005 concern (a source-only workspace package like
   `@backend/transport-ts` failing to resolve through the workflow compiler)
   does not reproduce — that was specific to hosting the *interactive* main
   loop under Nitro, not to using Workflow DevKit for a bounded background
   job. Self-hosted execution/replay state uses `@workflow/world-postgres`
   (a dedicated `workflow-postgres` Docker service); business state (which
   task, for whom, is it done) lives in executor's own MySQL `tasks` table —
   the same business/execution split chat already uses for Redis SSE replay
   vs. `agent_runs`.
3. **Task API is domain-agnostic.** `POST /tasks` (idempotent by
   `owner_service`+`owner_ref`) starts a task and returns immediately;
   `GET /tasks/:id` and `POST /tasks/:id/cancel` round out the contract —
   polling is the only progress channel; there is deliberately no
   `GET /tasks/:id/stream` (cut after review: it was built ahead of any real
   caller and its chunk shape was never defined — add it back with a
   concrete shape only once a consumer actually needs sub-poll-interval
   progress). A `TaskType` registry
   (`executor/src/tasks/registry.ts`) maps a type name to a Zod schema and a
   `"use workflow"` function — the seam a future `harness`-backed execution
   engine (Codex/Claude Code/Pi-style external session) plugs into without
   changing this contract or chat's tool-calling shape.
4. **`html-artifact` is the first `TaskType`**, migrated from
   `generation-runner.ts`: plan → bounded-concurrency block generation →
   compile → publish, each a `"use step"` function. Reliability now comes
   from Workflow DevKit's own step retry and durable execution — there is no
   claim/heartbeat/cancellation-poll code anymore, because one workflow run
   is the one and only owner of a task (the multi-worker racing that
   lease/claim existed for no longer applies).
5. **`write_file`/`edit_file`'s HTML branch is now non-blocking.** The tool
   call dispatches to executor and returns `{ status, task_id }`
   immediately; the ToolLoopAgent does not wait for generation to finish.
   Markdown generation is unchanged (a single fast `streamText` call needs no
   durability and stays inline in chat). This is a deliberate divergence from
   ADR-0012's "the ToolLoopAgent waits for each tool" stance for this one
   tool family, matching how Cursor/Codex background agents keep running
   after you stop watching them — cancelling a chat run does **not** cascade
   to cancelling an executor task it already dispatched.
6. **Frontend polls per-task, not per-conversation.** The old
   `GET /conversations/:id/artifact-jobs` (list all unfinished generations)
   is replaced by `GET /conversations/:id/tasks/:taskId` (proxied to
   executor), driven by the `task_id` embedded in the tool's own output.
   `ArtifactTaskCard` (replacing the dead `StreamingArtifactCard`/
   `ArtifactJobBar` code) owns the poll-until-terminal lifecycle for exactly
   the one task it renders.

## Consequences

- Artifact generation survives chat process loss and redeploys; it did not
  before. `resume_job_id`/"unfinished artifact jobs" model hints are removed
  — Workflow DevKit's replay makes them unnecessary, not just unimplemented.
- `chat/src/agent/artifacts/{worker,generation-runner,types}.ts` are deleted.
  `generator.ts`/`compiler.ts`/`template.ts`/`config.ts`/`clients/knowledge.ts`
  are trimmed to only what the markdown path and the read-only
  `run_command` (validate_html/inspect_layout) tool still need.
- Two Nitro v3 (beta) tracer bugs were hit and fixed, documented in
  `executor/AGENTS.md`: an ESM/CJS interop bug in `nf3` (patched via
  `pnpm patch`, `apps/backend/patches/nf3@0.3.18.patch`) and a path-depth bug
  copying `@vercel/oidc` (worked around via a `postbuild` script,
  `executor/scripts/fix-oidc-trace.mjs`). Neither is specific to our code;
  both should be re-checked when `nitro`/`workflow`/`ai` are next bumped.
- `infra/single-vps/docker-compose.prod.yml` (and the k8s prod/dev overlays)
  gain `executor` + a `workflow-postgres` service (self-hosted Workflow
  World), reversing the removal from ADR-0011/0006 — but scoped to
  `executor` only, not the main chat loop those ADRs were actually about.
  `WORKFLOW_POSTGRES_PASSWORD` was already a required key in
  `deploy-single-vps.yml`'s env-completeness check before this ADR (a
  leftover from ADR-0006 that had become dead weight after ADR-0011); it is
  now genuinely consumed again instead of being vestigial.
  The shared local-dev `docker-compose.yml` also runs the same
  `workflow-postgres` service, for dev/prod parity — an initial version of
  this ADR excluded it from local dev (defaulting to Workflow DevKit's
  filesystem Local World there) to keep `just up` lighter, but that was
  reverted: a real bug (executor never called `getWorld().start()`, so the
  Postgres World's job queue would never have actually processed a step in
  production — see `executor/AGENTS.md` "Known operational notes" #3) went
  undetected for an entire build-out phase specifically because local dev
  never exercised that code path. Parity surfaced it on the next normal
  local run instead of requiring a dedicated investigation.
- The `nf3` patch above is registered in `apps/backend/pnpm-workspace.yaml`'s
  `patchedDependencies`, which applies workspace-wide regardless of
  `--filter`. This broke `chat`'s Docker build (`ENOENT ...
  patches/nf3@0.3.18.patch`) even though `chat` never depends on `nf3` —
  pnpm hashes every referenced patch file against the lockfile before the
  filter narrows anything. Fixed by adding the same
  `COPY apps/backend/patches ./apps/backend/patches` that `executor`'s
  Dockerfile already had to `chat`'s Dockerfile too; verified with a real
  `docker build` of the `chat` image. Same regression risk applies to any
  future backend service Dockerfile — noted in root `AGENTS.md`'s
  "Common silent-breakers" and the new-microservice playbook's 反模式.
- Validated end to end: a real `html-artifact` task ran through
  `planStep` → `generateBlockStep` × N → `compileAndPublishStep` against a
  real provider (Volcano Engine DeepSeek) and produced a real published
  document; a `chat` → `executor` task-status proxy round-trip was verified
  live; a real mid-generation cancellation resolved in ~7s end to end.
- Cancellation latency turned out not to need custom AbortSignal forwarding:
  Workflow DevKit's `run.cancel()` interrupted an in-flight step within
  seconds in testing, not "wait for the current block to finish." The one
  real bug this surfaced was a misclassification — `run.returnValue` rejects
  with `WorkflowRunCancelledError` (`"workflow/errors"`), not a generic
  `AbortError` — fixed in `watchCompletion()`
  (`executor/src/tasks/service.ts`). Do not add a custom cancellation-poll
  mechanism inside `"use step"` functions without re-measuring first; it
  would reintroduce the class of complexity this ADR removed.
- Not yet done (left for follow-up, not blocking): wiring a real `harness`
  execution engine behind the same `TaskType` contract; generalizing beyond
  HTML (deep research, multi-file code tasks) — the registry and API are
  ready for this, only `html-artifact` and the `echo` smoke-test type exist
  today. Not doing this speculatively is intentional, not an oversight.
- Also cleaned up while reviewing this ADR critically rather than assuming
  the initial implementation was complete: a genuinely unused
  `GET /tasks/:id/stream` route (no caller ever used it — deleted rather
  than left "for later"); `chat` and `executor` had duplicated, not shared,
  copies of the SSRF-guarding provider client (`provider-url.ts` +
  `providers/model.ts`) — consolidated into `@backend/transport-ts` so the
  SSRF blocklist can't silently drift between the two copies; `executor` was
  missing from `build-images.yml`'s matrix, `infra/k8s/*`, and
  `infra/single-vps/docker-compose.prod.yml` entirely — a task type that
  only works in local dev is not actually done. `knowledge`'s
  `artifact-generations` router still had its `claim`/`renew`/`phase`/
  `claimable`/`unfinished` endpoints and a `resume_generation_id` field on
  `ReserveArtifactGenerationInput` — a multi-worker lease/heartbeat/resume
  protocol for chat's now-deleted worker pool, unreachable from any
  TypeScript code the
  moment migrate-artifact-worker landed but not noticed until this review
  (they live in a service this task hadn't touched yet, which is exactly the
  kind of blind spot "don't get anchored on your own diff" is meant to
  catch) — removed (`git blame` them if a future task ever needs multi-owner
  coordination again; the DB's `lease_owner`/`lease_expires_at` columns stay,
  since dropping them needs a migration, but are now only ever `None` or
  `"executor"`). `save_plan` now sets `status="running"` itself (the one
  remaining state transition previously done by the deleted `claim`
  endpoint) so `ArtifactGeneration.status` doesn't get stuck reporting
  `"queued"` for a generation that is actually executing.
- `executor/package.json` had no `lint` script (only `typecheck`), so
  `just lint` (root AGENTS.md's own "definition of done" step) was silently
  broken for the whole repo the moment `executor` joined `NODE_SERVICES` in
  `apps/backend/justfile` — `lint-node` iterates that list and shells out to
  `pnpm run lint` unconditionally. Fixed by aliasing `lint` to the same `tsc
  --noEmit` command `typecheck` already ran.
