# admin service

The admin (智能体) microservice. Manages bot lifecycle, ownership, publishing.

## Owns
- DB tables for bots, skills, model providers, and the platform app registry
- HTTP APIs externally exposed by gateway under `/api/admin-server/*`

## Does NOT own
- IAM identity, tenants/workspaces, membership and roles (→ iam). Resource
  authorization and business audit remain the owning service's responsibility.
- Skill attachment/archive bytes, physical retention, signed delivery, and GC
  (→ asset service). Admin stores exact Asset revision references and owns
  editable skill-tree and publication semantics.

## Entry points
- `src/main.py` — FastAPI app
- `src/api/http/routes/*.py` — HTTP handlers
- `src/application/contracts/*.py` — Pydantic request/response schemas
- `src/application/*.py` — business orchestration
- `src/domain/skills.py` — Skill workspace and publishing invariants
- `src/infrastructure/persistence/repositories/*.py` — persistence operations
- `src/infrastructure/persistence/models/*.py` — SQLAlchemy ORM table models
- `src/gen_openapi.py` — OpenAPI export (run by `just gen-openapi admin`)

## Conventions
- Routers are thin: request/response wiring only.
- Business orchestration lives in `application/`.
- DB access lives in `infrastructure/persistence/repositories/`; routes never touch SQLAlchemy directly.
- Transactions (docs/ADR/architecture.md): repositories only read/stage (`add`/`flush`/`delete`/
  `select`) and NEVER commit. The `application/` method that owns a write unit of
  work opens `async with write_tx(session):` before any DB access and does all
  its reads + writes inside that block (autobegin-first). Keep external IO (DNS
  validation, Redis) outside the block.
- Pydantic API shapes live in `application/contracts/`; SQLAlchemy table definitions
  live in `infrastructure/persistence/models/`.
- Keep business resources separated end-to-end. Each table/resource gets its
  own files in API, application, repository, and persistence-model layers. Do NOT merge distinct
  business resources into a generic shared CRUD/model/schema/service just to
  reduce boilerplate; prefer explicit, single-responsibility modules.
- Skill text files remain inline for precise code-agent edits. Binary skill
  files and imported ZIP sources are immutable Asset revisions; published
  snapshots pin exact revision IDs and protect them with snapshot Claims.
- Errors via `libs.kernel.errors.*`, NEVER raw HTTPException

## Verification after code changes

Run `just test backend/admin` from the repository root. Test conventions and
runner configuration are owned by `apps/backend/AGENTS.md`; add regression
coverage for changed behavior before reporting completion.
