# Backend Monorepo — Microservices

Python 3.12 + FastAPI + SQLAlchemy 2.0 (Alembic) + gRPC.
Go for performance-critical services (api-gateway).

## Layout

- `services/<name>/`  — independently deployable microservice
- `libs/<name>/`      — shared kernel (KEEP THIN; see boundaries)

## Hard rules

### Service autonomy
- Each `services/<name>/` is independently deployable, dockerized, versioned
- A service MUST own its own DB (or at least its own schema)
- Services NEVER import from each other's `services/<other>/src/`
- Cross-service calls go through `libs/transport/` clients (gRPC or HTTP)
- Cross-service data flow is async via events (CloudEvents) when possible

### Shared kernel discipline (CRITICAL)
The libs/ are the most dangerous abstraction. Strict rules:

| Lib | Purpose | Soft cap |
|---|---|---|
| `libs/kernel`        | errors, context, config, logging | < 1500 LoC |
| `libs/transport`     | gRPC/HTTP clients, retry, breaker | < 1500 LoC |
| `libs/observability` | OTel setup | < 800 LoC |
| `libs/auth_sdk`      | JWT verify, identity propagation | < 1000 LoC |
| `libs/audit_sdk`     | publish audit events | < 800 LoC |

**NEVER** add domain logic to `libs/`. **NEVER** add a `libs/utils/`. **NEVER**
share Pydantic models across services via libs — each service owns its own DTOs.

### Adding a new service
1. `./scripts/new-service.sh <name>` (run from repo root)
2. Add to `apps/backend/justfile` SERVICES list
3. Add `infra/k8s/base/<name>/` manifests
4. Add `.github/workflows/deploy-<name>.yml`
5. Document in `docs/微服务/<name>.md`

### Adding a route
- Routes go in `services/<name>/src/<name>/routes/<resource>.py`
- Apply `@require_action(...)` for mutations
- Use `libs.kernel.errors.*`, NEVER raise raw HTTPException
- Audit successful mutations via `libs.audit_sdk.record(...)`

## Commands (from `apps/backend/`)

| Command | Purpose |
|---|---|
| `just dev <service>` | Run one service locally |
| `just lint <service>` | ruff + mypy scoped |
| `just fmt` | ruff format + gofmt (auto-run, no need to ask) |
| `just gen-openapi <service>` | Export to `schemas/openapi/<name>.json` |
| `just gen-openapi-all` | Export all services |
| `just migrate-new <svc> <msg>` | New alembic revision |
| `just migrate-up <svc>` | Apply migrations |

## Size limits
- ≤ 500 LoC per Python module (excl. tests)
- ≤ 800 LoC hard ceiling — split into a new module if exceeded
- ≤ 1500 LoC per `libs/*` package

## Forbidden zones for agents
- `services/*/migrations/versions/**` — DB migrations (require explicit ask)
- `**/.env*`

## Done checklist
1. `just fmt`
2. `just lint <service>`
3. `just test <service>`
4. If API changed: `just gen-openapi <service>`
5. If shared kernel changed: list ALL consumer services in PR description
