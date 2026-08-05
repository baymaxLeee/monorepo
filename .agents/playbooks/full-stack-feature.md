# Playbook: Full-stack feature (single-agent)

The default workflow for implementing a feature spanning one backend service
and one micro-frontend. **You (the main agent) do everything in one context
window**. Do NOT split into separate frontend/backend sub-agents.

## Prerequisites

- Read root `AGENTS.md`
- Required input from user: feature name + 1-sentence description
- Identify: which backend service(s) and which MFE(s) are affected

## Checklist

```
[ ] 1. Clarify API contract with user (paths, request/response, error codes)

[ ] 2. (If non-trivial) draft ADR at docs/ADR/NNNN-<slug>.md

[ ] 3. BACKEND
       cd apps/backend/services/<svc>
       Read svc-level AGENTS.md ONCE
       Implement route + Pydantic models
       During demo phase, do not add tests or test scaffolding
       From apps/backend: `just gen-openapi <svc>`
       → schemas/openapi/<svc>.json updated

[ ] 4. SYNC CODEGEN
       From root: `just sync`
       (May spawn `codegen-runner` sub-agent if slow; not required.)

[ ] 5. FRONTEND
       cd apps/frontend/apps/<mfe>
       Read mfe-level AGENTS.md ONCE
       Import the freshly generated client from @repo/api
       Implement UI; during demo phase, do not add tests or test scaffolding

[ ] 6. INTEGRATION CHECK
       From root: `just lint && just build`
       Exercise the changed flow against the running stack

[ ] 7. (Optional) Fresh-eyes review
       Dispatch `reviewer` sub-agent over the diff
       The reviewer should NOT see your design notes — that's the point

[ ] 8. Commit:
       feat(<svc>): add ...
       feat(mfe-<name>): add ...
       (Two commits OR one with both scopes; team preference)
```

## Anti-patterns

- ❌ Dispatching a `backend-impl` sub-agent and a `frontend-impl` sub-agent —
  they would lose the cross-stack context you just built up.
- ❌ Skipping step 4 (sync) — frontend would use stale types.
- ❌ Editing files under `**/generated/**` directly — they will be overwritten.
- ❌ Editing migrations without explicit user approval.

## When stuck

- Read `apps/backend/AGENTS.md` for backend conventions
- Read `apps/frontend/AGENTS.md` for frontend conventions
- Read `docs/微服务/` and `docs/微前端/` for architectural guidance
