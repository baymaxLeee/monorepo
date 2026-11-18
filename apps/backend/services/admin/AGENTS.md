# admin service

The admin configuration microservice. Manages providers, skills, applications and publishing.

## Owns
- DB tables for skills, model providers, and the platform app registry
- HTTP APIs externally exposed by gateway under `/api/admin-server/*`

## Does NOT own
- IAM identity, tenants/workspaces, membership and roles (→ iam). Resource
  authorization and business audit remain the owning service's responsibility.
- Skill attachment/archive bytes, physical retention, signed delivery, and GC
  (→ asset service). Admin stores exact Asset revision references and owns
  editable skill-tree and publication semantics.

## Entry points
- `cmd/server/main.go` — HTTP server
- `cmd/openapi/main.go` — OpenAPI export (run by `just gen-openapi admin`)
- `internal/api/http/*.go` — HTTP handlers
- `internal/application/*.go` — business orchestration
- `internal/domain/*.go` — business invariants
- `internal/infrastructure/persistence/*.go` — PostgreSQL persistence

## Conventions
- Routers are thin: request/response wiring only.
- Business orchestration lives in `application/`.
- DB access lives in `internal/infrastructure/persistence/`; routes never issue SQL.
- Application methods own transaction boundaries. Keep external IO outside database transactions.
- OpenAPI-generated wire types live in `internal/api/generated/`; domain types stay transport-independent.
- Keep business resources separated end-to-end. Each table/resource gets its
  own files in API, application, repository, and persistence-model layers. Do NOT merge distinct
  business resources into a generic shared CRUD/model/schema/service just to
  reduce boilerplate; prefer explicit, single-responsibility modules.
- Skill text files remain inline for precise code-agent edits. Binary skill
  files and imported ZIP sources are immutable Asset revisions; published
  snapshots pin exact revision IDs and protect them with snapshot Claims.
- Return application errors through the shared HTTP problem writer; never expose raw infrastructure errors.

## Verification after code changes

Run `just test backend/admin` from the repository root. Test conventions and
runner configuration are owned by `apps/backend/AGENTS.md`; add regression
coverage for changed behavior before reporting completion.
