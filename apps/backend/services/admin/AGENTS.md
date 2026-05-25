# admin service

The admin (智能体) microservice. Manages bot lifecycle, ownership, publishing.

## Owns
- DB tables: `bots`, `bot_versions`, `bot_publish_history`
- HTTP API: `/bot/*` internally; externally exposed by gateway as
  `/api/admin-server/bot/*`
- gRPC API: `bot.v1.BotService` (defined in `schemas/proto/bot/v1/`)

## Does NOT own
- Bot scenes (→ scene service)
- Bot intentions (→ intention service)
- Bot audit log (→ audit service via events)

## Entry points
- `src/admin/main.py` — FastAPI app
- `src/admin/routers/*.py` — HTTP handlers
- `src/admin/services/*.py` — business orchestration
- `src/admin/crud/*.py` — persistence operations
- `src/admin/models/*.py` — SQLAlchemy ORM table models
- `src/admin/schemas/*.py` — Pydantic request/response schemas
- `src/admin/grpc/server.py` — gRPC server (when added)
- `src/admin/gen_openapi.py` — OpenAPI export (run by `just gen-openapi admin`)

## Conventions
- Routers are thin: request/response wiring only.
- Business rules live in `services/`.
- DB access lives in `crud/`; routers never touch SQLAlchemy directly.
- Pydantic API shapes live in `schemas/`; SQLAlchemy table definitions live in `models/`.
- Keep business resources separated end-to-end. Each table/resource gets its
  own `models/<resource>.py`, `schemas/<resource>.py`, `crud/<resource>.py`,
  `services/<resource>.py`, and `routers/<resource>.py`. Do NOT merge distinct
  business resources into a generic shared CRUD/model/schema/service just to
  reduce boilerplate; prefer explicit, single-responsibility modules.
- Errors via `libs.kernel.errors.*`, NEVER raw HTTPException
