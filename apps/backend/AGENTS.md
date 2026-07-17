# Backend Monorepo — Microservices

Python 3.14 + FastAPI + SQLAlchemy 2.0 (Alembic) + gRPC.
Go for performance-critical services (gateway).

## Layout

- `services/<name>/`  — independently deployable microservice
- `libs/<name>/`      — shared kernel (KEEP THIN; see boundaries)

## Hard rules

### Service autonomy
- Each `services/<name>/` is independently deployable, dockerized, versioned
- A service MUST own its own DB (or at least its own schema)
- Service-owned SQL migrations live in
  `services/<name>/migrations/versions/vX.Y.Z.sql`
- Services NEVER import from each other's `services/<other>/src/`
- Cross-service calls go through `libs/transport/` clients (gRPC or HTTP)
- Cross-service data flow is async via events (CloudEvents) when possible

### Database migrations
- Each service database MUST contain a single-row `migration` table:
  `id = 1`, `version = vX.Y.Z`, `update_time`.
- Migration filenames MUST be exactly the semantic version including the `v`
  prefix, for example `v1.0.0.sql`. Do not add description suffixes.
- `just up` discovers services with SQL migrations and applies pending
  migrations through `scripts/db-migrate.sh`.
- Migration execution range is `(current_version, target_version]`.
- If no target version is passed, target version defaults to the latest local
  migration version in that service directory.
- After each SQL file succeeds, the migrator updates `migration.version` to
  that file's version.
- Service processes MUST NOT create or mutate schema at startup. Startup may
  seed demo data only after migrations have prepared the schema.

### Gateway responsibilities
- The service is named `gateway`, not `api-gateway`.
- Gateway owns edge concerns: routing, auth boundary, CORS, request logging,
  reverse proxying, and trace propagation.
- The canonical trace header is `X-Trace-Id`. Do NOT introduce
  `X-Request-Id`.
- Gateway normalizes or generates `X-Trace-Id`, writes it to the response,
  propagates it to upstream services, and includes `trace_id` in structured
  logs.

### Resource module boundaries
- Keep business resources separated end-to-end inside every service.
- Each table/resource gets its own resource-specific modules, for example
  `application/contracts/<resource>.py`, `api/http/routes/<resource>.py`,
  `application/<resource>.py`, optional `domain/<resource>.py`,
  `infrastructure/persistence/models/<resource>.py`,
  and `infrastructure/persistence/repositories/<resource>.py` for Python services.
- Do NOT merge distinct business resources into a generic shared
  CRUD/model/schema/service layer just to reduce boilerplate. Prefer explicit,
  single-responsibility modules that can evolve independently.
- `domain/` is reserved for framework-independent invariants, value objects,
  policies, and deterministic state transitions. It MUST NOT import `api`,
  `application`, `infrastructure`, ORM models, HTTP frameworks, or runtime SDKs.
- Do not create placeholder domain modules for transport DTOs or CRUD-only
  resources.
- Small shared helpers are acceptable only when they are behavior-free
  infrastructure glue; resource ownership, query rules, DTOs, and business
  orchestration stay in the resource-specific modules.

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
- Routes go in `services/<name>/src/api/http/routes/<resource>.py`
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
| `just migrate-new <svc> <version>` | New service-owned SQL migration, versioned as `vX.Y.Z` |
| `just migrate-up <svc> [target-version]` | Apply SQL migrations in `(current, target]`; defaults to latest local version |

### TypeScript 7

- `@typescript/native` 固定原生 TypeScript 7，负责 Node 服务和 TypeScript kernel 的
  `build` / `lint` / `typecheck`。脚本必须显式调用
  `node_modules/@typescript/native/bin/tsc`，不得使用来源不确定的裸 `tsc`。
- `typescript` 5.x 暂时保留给 Nitro、Workflow TypeScript plugin、OpenAPI 工具等旧
  编程 API 消费者，不负责仓库代码检查；这些工具支持 TS7 稳定 API 后直接删除旧版本。
- 普通 Node package 不得直接声明旧 `typescript`；只有承载明确旧 API / peer
  消费者的 package 可保留 TS5，其他包只声明 `@typescript/native`。
- 所有 Node `tsconfig.json` 必须显式声明 `"types": ["node"]`；TS7 不再默认注入
  `@types/*` 全局类型。

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
