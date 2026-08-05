# ADR 0061: Backend shared capability extraction policy

**Date**: 2026-08-05  
**Status**: Accepted  
**Related**: ADR-0060; `docs/plans/engineering-structure-restructure.md` Phase 3

## Context

A Wave-1 “mega-kernel” attempt pulled auth, persistence, problem/errors,
logging, and security into `libs/kernel{,-ts}` and a new `libs/kernel-go` in
one change. It altered Docker contexts, OpenAPI (Knowledge `X-Auth-Roles`),
and CI assumptions without per-capability ADRs. That work was rolled back.

We still want shared infrastructure where it earns its keep — but extraction
must follow consumer evidence, not language symmetry.

## Decision

For every candidate capability:

1. Build a **consumer matrix** (service × need × current location).
2. Choose exactly one: **share implementation**, **share contract only**, or
   **keep in-service**.
3. Write a focused ADR (or an amendment here) before code moves.
4. Migrate one consumer, verify, then the rest; delete old copies with no shim.
5. Never mix **auth** or **persistence** with transport / problem / logging in
   the same change set.

### Recommended order and current verdict (2026-08-05)

| Capability | Consumers today | Verdict |
|---|---|---|
| `transport-ts` | chat, executor (typed OpenAPI clients) | **Keep** — already justified |
| `transport-py` | knowledge → admin only | **Defer package** — single consumer; keep `knowledge` local admin client until a second Python caller appears |
| problem/error serialization | python kernel errors; TS per-service problem helpers | **Share contract first** (RFC7807 field names); share code only when ≥2 runtimes need identical helpers beyond kernel’s existing errors |
| trace context / logging | already partially in kernels | **Incremental only** — unify field names across kernels in one commit when changing; no new mega-package |
| auth header parsing | gateway + each service | **High risk — defer** — requires OpenAPI / issuer / roles audit; must not auto-surface headers into public schemas |
| DB session / persistence | each service owns pool + migrations | **Do not share** in demo phase — ownership and transaction semantics differ |
| password / JWT crypto | iam (+ gateway verify) | **Do not invent a shared crypto lib** — prefer mature libraries; extract only after security review |

### Capability package rules

- At least two real consumers, **or** a must-centralize security/protocol
  implementation with an explicit ADR.
- One primary purpose; no domain models in `libs/`.
- No pre-building `kernel-go` / `transport-py` for symmetry.

## Consequences

- Phase 3 of the restructure plan is **policy + deferred extractions**, not a
  second mega-kernel.
- When a second Python service needs the admin internal client, open a
  transport-py ADR with the matrix and migrate knowledge first.
- Auth/persistence remain service-local until separately approved.

## Alternatives considered

- **Re-apply Wave-1 mega-kernel**: rejected (contract + CI blast radius)
- **Share everything that looks similar**: rejected (false symmetry)
