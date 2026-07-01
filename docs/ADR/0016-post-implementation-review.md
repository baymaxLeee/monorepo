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
