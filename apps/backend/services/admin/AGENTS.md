# admin service

The admin (智能体) microservice. Manages bot lifecycle, ownership, publishing.

## Owns
- DB tables for bots, skills, model providers, and the platform app registry
- HTTP APIs externally exposed by gateway under `/api/admin-server/*`
- gRPC API: `bot.v1.BotService` (defined in `schemas/proto/bot/v1/`)

## Does NOT own
- Bot audit log (→ audit service via events)

## Entry points
- `src/main.py` — FastAPI app
- `src/api/http/routes/*.py` — HTTP handlers
- `src/application/contracts/*.py` — Pydantic request/response schemas
- `src/application/*.py` — business orchestration
- `src/domain/skills.py` — Skill workspace and publishing invariants
- `src/infrastructure/persistence/repositories/*.py` — persistence operations
- `src/infrastructure/persistence/models/*.py` — SQLAlchemy ORM table models
- `src/grpc/server.py` — gRPC server (when added)
- `src/gen_openapi.py` — OpenAPI export (run by `just gen-openapi admin`)

## Conventions
- Routers are thin: request/response wiring only.
- Business orchestration lives in `application/`.
- DB access lives in `infrastructure/persistence/repositories/`; routes never touch SQLAlchemy directly.
- Transactions (ADR-0037): repositories only read/stage (`add`/`flush`/`delete`/
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
- Errors via `libs.kernel.errors.*`, NEVER raw HTTPException
