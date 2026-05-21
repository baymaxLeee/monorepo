# bot service

The bot (智能体) microservice. Manages bot lifecycle, ownership, publishing.

## Owns
- DB tables: `bots`, `bot_versions`, `bot_publish_history`
- HTTP API: `/v1/bots/*`
- gRPC API: `bot.v1.BotService` (defined in `schemas/proto/bot/v1/`)

## Does NOT own
- Bot scenes (→ scene service)
- Bot intentions (→ intention service)
- Bot audit log (→ audit service via events)

## Entry points
- `src/bot/main.py` — FastAPI app
- `src/bot/routes/*.py` — HTTP handlers
- `src/bot/grpc/server.py` — gRPC server (when added)
- `src/bot/gen_openapi.py` — OpenAPI export (run by `just gen-openapi bot`)

## Conventions
- Pydantic models inline in route file (when small) or in `models/` (when shared)
- DB access via `repository/` pattern; routes never touch SQLAlchemy directly
- All mutations wrapped in `libs.audit_sdk.record(...)` on success
- Errors via `libs.kernel.errors.*`, NEVER raw HTTPException

## Tests
- Unit: `tests/unit/test_*.py`
- API:  `tests/api/test_*.py` (uses TestClient)
- Run:  `cd apps/backend && just test bot`
