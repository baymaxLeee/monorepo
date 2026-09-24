# ADR 0016: Post-implementation critical review for multi-phase migrations

## Status

Accepted.

## Context

[ADR-0015](0015-agent-task-executor.md)'s `executor` service was built across
five phases, declared complete, and passed every functional test run during
development. A follow-up review pass — explicitly asked for with instructions
to not anchor on the just-written implementation and to hunt for redundant
logic — found, within the same change, several defects that functional
testing never would have caught:

1. A real bug: cancellation was misclassified as `"failed"` instead of
   `"cancelled"` because `WorkflowRunCancelledError` isn't a generic
   `AbortError`. Found by writing an actual mid-generation cancellation test
   that the original implementation work never ran.
2. A documented "known limitation" (cancellation waits for the current block
   to finish) that was never actually measured — it turned out to be false;
   Workflow DevKit's own cancellation is fast. The doc was speculative, not
   empirical.
3. Speculative code with zero callers: a `GET /tasks/:id/stream` endpoint
   built ahead of any real consumer, never wired to anything.
4. A production-deployment gap: `executor` was fully wired into local dev
   (`Procfile.dev`, `docker-compose.yml`, root `justfile`) but never added to
   `infra/k8s/*`, `infra/single-vps/docker-compose.prod.yml`, or
   `build-images.yml`'s matrix — despite `.agents/playbooks/new-microservice.md`
   already documenting this exact checklist. The playbook existed; it was not
   consulted while deep in an unrelated Nitro-bug rabbit hole, and nothing
   forced a return to it before declaring the feature done.
5. A broken canonical command: `executor/package.json` had no `lint` script,
   so `just lint` — root `AGENTS.md`'s own "Definition of done" step —
   silently failed for the whole repo the moment `executor` joined
   `NODE_SERVICES`. Nobody had run bare `just lint` after the change; only
   the new service's own typecheck.
6. Duplicated security-sensitive code: `chat` and `executor` each carried a
   byte-for-byte copy of the SSRF-guarding provider client, a maintenance
   trap (a blocklist fix applied to one copy silently doesn't apply to the
   other).
7. Dead code in a third, untouched service: `knowledge`'s
   `claim`/`renew`/`phase`/`claimable`/`unfinished` artifact-generation
   endpoints implemented a multi-worker lease protocol that became
   unreachable the moment `chat`'s worker pool was deleted in this same
   change — but `knowledge` is a Python service nobody had reason to open
   while working in TypeScript, so the dead code sat unnoticed.

None of these were exotic. Each was individually easy to check for — the
common failure mode was **treating "the new code works" as equivalent to
"the change is complete,"** without a distinct pass that assumes the initial
implementation is incomplete and goes looking for evidence.

## Decision

For any task that spans more than ~2 phases or touches more than one
service, run an explicit review pass **after** functional work is declared
done and **before** telling the user it's finished, structured as:

1. **Re-run the relevant `.agents/playbooks/*.md` checklist from scratch**,
   even (especially) if it was skipped or partially followed during
   implementation because of an unrelated blocker (a beta-tooling bug, a
   design pivot, etc.). Treat "I got distracted by X" as a signal to
   re-verify, not evidence that the rest was fine.
2. **Grep for callers, not just definitions, across the whole repo** —
   specifically in services the current task never opened. Anything a
   deleted/migrated code path used to call is a dead-code candidate in
   whichever service it lived in, including services in a different
   language than the one you were just working in.
3. **Check production deployment surfaces explicitly**: `infra/k8s/*`,
   `infra/single-vps/docker-compose.prod.yml`, `.github/workflows/*.yml`
   matrices. "Works in `just dev`" and "works in production" are different
   claims; a new service that only wires the first is not done.
4. **Run the bare canonical commands** (`just lint`, `just build`,
   `just sync`) with no service argument, not just the scoped version for
   the service you touched. A new service can break these for everyone else.
5. **Replace every speculative "known limitation" with a measurement**
   before writing it into an ADR or doc. If a limitation can be tested in
   under a few minutes (start a task, cancel it, see what happens), test it;
   don't document an assumption as fact.
6. **Look for duplicated logic introduced by the same change**, particularly
   anything security- or correctness-sensitive (auth checks, SSRF/input
   validation, provider adapters) copy-pasted across services instead of
   shared through the existing `libs/` boundary.
7. **Cut, don't flag, code with zero real callers** (an endpoint, a wrapper
   function, an env var) discovered during the review — "leave it for later
   in case something needs it" is how dead code accumulates. Re-adding a
   deleted, git-tracked file later is nearly free; carrying unused surface
   area forward is not.

This is a *process* decision, not a one-time cleanup: apply it to future
multi-phase work in this repo, not only to `executor`.

## Consequences

- Root `AGENTS.md`'s "Definition of done" section links here instead of
  re-stating the checklist, keeping the universal rules file from growing
  unbounded.
- `.agents/playbooks/new-microservice.md` gained explicit Node.js coverage
  (the `lint` script requirement) and two new anti-pattern bullets — the
  gaps this review found should not require rediscovery next time.
- A new skill, `.cursor/skills/nitro-workflow-devkit/SKILL.md`, captures the
  Nitro v3 beta bugs and the pnpm `@ai-sdk/provider` version-conflict trap
  found while building `executor`, so the next Nitro-based service doesn't
  re-debug them from scratch.
- This review pass has a real time cost (roughly comparable to the
  implementation phases it followed, in this instance) — it is only
  proportionate for multi-phase or multi-service changes, not every small
  fix. Use judgment; don't turn a one-file bug fix into a full audit.

## 2026-09-23 backend-wide review application

The review procedure was applied to all eight registered backend services
(`gateway`, `iam`, `admin`, `chat`, `knowledge`, `telemetry`, `executor`, and
`canvas`), their shared transport contracts, and both production deployment
surfaces. The target architecture remains one Chat `ToolLoopAgent` for
interactive reasoning and one Executor Workflow runtime for deterministic,
durable work. Service ownership remains explicit; no service imports another
service's source or database, and shared libraries contain transport and
infrastructure capabilities rather than domain models.

The review found and corrected four recurring classes of systemic defect:

1. **Identity and tenancy were being treated as transport metadata instead of
   authorization inputs.** Internal receivers now authenticate the declared
   caller with a caller-specific workload credential. Public Canvas routes use
   the Gateway-established user/workspace identity and enforce project access;
   Knowledge retrieval filters both tenant and workspace. Gateway no longer
   invents an internal-service identity for public requests.
2. **Long-running work was coupled to a process.** Knowledge document
   conversion/indexing now persists intent, dispatches bounded Executor
   workflows, uses database advisory locks for idempotent execution, and
   replaces chunks atomically. Chat cancellation waits for a durable terminal
   run state, and conversation deletion refuses to race an active lease.
   Executor cleanup uses a cross-replica lock and video-production failures
   after projection creation converge to a terminal projection.
3. **Resource and side-effect boundaries were incomplete.** Upload and RUM
   payloads are bounded, non-finite telemetry values are rejected or
   normalized, Canvas downloads bind validation to the dialed address, and
   archive cleanup checks ownership before deleting shared objects. Canvas
   quota accounting, reconciliation, archive cleanup, and asset garbage
   collection are now assembled in production. Quota enforcement remains
   report-only until Admin exposes an authoritative entitlement source; the
   system records would-reject decisions rather than fabricating limits.
4. **Deployment checks were weaker than local checks.** Non-development
   services reject development workload/JWT/database credentials, Gateway rate
   limiting is Redis-backed across replicas, session-cookie mutations require
   an allowed Origin outside development, database migrations and Workflow
   World setup precede rollout, and the Knowledge RWO deployment uses a
   single-writer strategy. K8s network policy and both secret-rendering paths
   carry the per-caller credentials.

The implementation deliberately did not create a service mega-kernel or a
second role-playing agent loop. This follows the installed AI SDK guidance:
`ToolLoopAgent` owns the interactive tool loop, resumable UI transport treats a
disconnect separately from explicit cancellation, and durable Workflow steps
own replayable external work. It also matches the useful common shape in
Claude Code, Codex, and Cursor: one primary context, explicit tool side effects,
bounded approvals, cancellation, persistence, and compaction; helper workers do
not acquire independent product intent.

### Risks requiring a different boundary

The review also identified issues for which a local patch would be misleading:

- Administrator-configured provider URLs are checked at configuration and
  request time, redirects are rejected, and literal/private addresses are
  blocked. DNS can still change between validation and the runtime's actual
  connection. Full protection requires either a controlled outbound proxy or a
  transport that pins a validated address while preserving the HTTP Host header
  and TLS SNI. A second preflight lookup is not claimed as complete SSRF
  protection.
- A paid provider may create a task and lose the response before returning its
  provider task identifier. The workflow preserves the reservation on this
  ambiguous path and disables unsafe automatic replay, but automatic recovery
  requires a provider-supported idempotency key or lookup-by-client-key
  contract.
- Canvas generation-history reads are capped at the newest 100 records and image
  histories now batch-load task/input rows. True continuation pagination remains
  a future API-contract improvement if the product needs older history.

The review fixed the corresponding local issues directly: Telemetry now ships
the `(user_id, ts_server DESC)` index as a service-owned forward migration, and
the unused Canvas claim/heartbeat HTTP boundary was removed because production
execution already uses Executor endpoints plus the async event consumer.

These are tracked as explicit architectural constraints rather than
compatibility shims. A future change that activates any affected path must
resolve the corresponding boundary first.

## 2026-09-24 Asset control-plane migration application

ADR-0072's implementation review covered the new Go Asset service and all
current byte-producing consumers. It found lifecycle and integration defects
that scoped happy-path checks would not expose: abandoned upload staging was
not collected, cached Claim counts could drift, consumer Claim identities were
not fully tenant/workspace scoped, Admin archive downloads trusted size without
verifying SHA-256, ZIP directory entries bypassed the entry budget, and stale
Canvas-to-Knowledge bindings survived after the byte path moved to Asset.

Because local and Single-VPS environments are explicitly reinstallable, the
review then removed the obsolete Canvas migration chain instead of preserving a
compatibility sequence. The target schema now lives directly in v1.0; the old
reference-count/GC tables and intermediate rename migrations were deleted, and
both Canvas and Asset baselines were applied to isolated fresh PostgreSQL
databases. This also exposed and fixed cover quota/deletion identities that used
the shared revision ID rather than the owning attachment plus generation.

The byte-path review found two additional retry and memory hazards. Executor
video downloads, assembly, QA, and upload materialized complete videos as
`Uint8Array`; they now use bounded streams and scratch files. Internal Asset
uploads now require a caller-scoped idempotency key, and every producer derives
it from a stable workflow or domain operation identity. An end-to-end service
check verified that a replay returns the original revision without consuming a
new body and that immutable delivery returns `206 Partial Content` with the
expected `Content-Range`.

Canonical `just sync`, `just lint`, and `just build` passed after correction.
Both K8s overlays and Single-VPS Compose rendered successfully, and the
machine-readable service topology matched the nine deployed services. Asset
and Canvas Go tests/vet, Admin/Knowledge Ruff and strict mypy, Admin ZIP/Claim
tests, Chat/Executor lint builds, and affected frontend typechecks/tests also
passed. Browser interaction was not used because the relevant upload and
ownership behavior was verifiable from contracts, source, generated clients,
and service tests.
