# Backend Monorepo — Microservices

Python 3.14 + FastAPI, Node.js + TypeScript, and Go services. Root `services.yaml`
is the canonical backend composition graph; it declares runtime, port, public
routes, outbound bindings, owned databases, and optional OpenAPI artifacts.

## Layout

- `services/<name>/` — independently deployable microservice
- `libs/kernel/` — thin Python errors, logging, tracing, and observability
- `libs/kernel-ts/` — thin TypeScript runtime primitives
- `libs/transport-ts/` — generated-contract-based internal HTTP clients

Do not create a shared package for language symmetry. Follow ADR-0061: build a
consumer matrix, choose share implementation / share contract / keep local,
and record high-risk extraction decisions before moving code.

## Hard rules

### Service autonomy

- Each service owns its runtime, dependency manifest, Dockerfile, and data.
- Service-owned SQL migrations live in
  `services/<name>/migrations/versions/vX.Y.Z.sql`.
- Services never import another service's source.
- Cross-service calls use explicit bindings from `services.yaml` and transport
  clients; asynchronous flows use shared event contracts where appropriate.
- A service must not read or mutate another service's database.

### Database migrations

- Each service database contains a single-row `migration` table with `id = 1`,
  `version`, and `update_time`.
- Migration filenames are semantic versions including the `v` prefix, for
  example `v1.0.0.sql`; do not add description suffixes.
- `just up` discovers and applies service-owned migrations through
  `scripts/db-migrate.sh`; processes do not create or mutate schemas at startup.

### Gateway responsibilities

- The service is `gateway`, not `api-gateway`.
- Gateway owns the public edge: routing, auth boundary, CORS, rate limiting,
  request logging, reverse proxying, and trace propagation.
- `X-Trace-Id` is canonical; do not introduce `X-Request-Id`.
- `executor` remains internal-only unless an ADR changes that decision.

### Resource boundaries

- Keep business resources separate end-to-end: transport DTO, application
  orchestration, optional domain policy, persistence model, and repository.
- `domain/` contains framework-independent invariants and deterministic state
  transitions. It must not import API, application, infrastructure, ORM, HTTP,
  or runtime SDK modules.
- Do not create placeholder domain modules for CRUD-only resources.
- Do not merge unrelated resources into generic CRUD/model/schema modules merely
  to reduce boilerplate.

### Shared capability discipline

- `libs/` contains infrastructure capabilities only; never domain models.
- A shared implementation needs at least two real consumers, or a
  must-centralize security/protocol reason documented in an ADR.
- Auth, persistence, and crypto are separate high-risk decisions. Do not bundle
  them into a mega-kernel or create `auth_sdk`, `audit_sdk`, `transport-py`, or
  a Go kernel speculatively.
- Never add `libs/utils/` or share Pydantic domain DTOs across services.

## Adding a service or route

For a service, follow `.agents/playbooks/new-microservice.md`. The change is not
integrated until `services.yaml`, workspaces, justfile, Procfile, local env,
gateway when public, K8s, Single-VPS, CI, contracts, and docs agree. Run
`scripts/check-services.py` through root `just lint` to catch drift.

Routes live in `services/<name>/src/api/http/routes/<resource>.py` for Python.
Use `kernel.errors` rather than raw `HTTPException`. Authorization and audit
behavior remain service-owned unless a focused ADR establishes a shared
capability.

## Commands (from `apps/backend/`)

| Command | Purpose |
|---|---|
| `just dev <service>` | Run one registered service locally |
| `just lint [service]` | Oxc/TS7 plus scoped or all Python/Node/Go checks |
| `just fmt` | Rewrite supported source using root Oxfmt, Ruff, and gofmt; run only when requested or needed |
| `just gen-openapi <service>` | Export one Python/Node OpenAPI contract |
| `just gen-openapi-all` | Export all registered Python/Node contracts |
| `just migrate-new <svc> <version>` | Create a service-owned migration |
| `just migrate-up <svc> [target]` | Apply migrations in `(current, target]` |

### TypeScript 7

- `@typescript/native` is the repository code checker. Scripts call
  `node_modules/@typescript/native/bin/tsc` explicitly, never an ambiguous bare
  `tsc`.
- TypeScript 5 remains only for tools that consume its legacy API; ordinary
  packages must not declare it without such a consumer.
- Node tsconfig files explicitly declare `"types": ["node"]`.
- Root Oxlint and Oxfmt are the only JS/TS style configuration.

## Forbidden zones for unprompted edits

- `services/*/migrations/versions/**`
- `**/.env*`

## Done checklist

1. Run root `just lint` (tests are intentionally skipped during demo phase).
2. If API changed, run root `just sync` and verify both stacks build.
3. Run `just fmt` only when explicitly requested or mechanical drift requires it.
4. If a shared capability changed, list every consumer and verify each one.
5. If composition changed, validate `just install`, `just up`, `just dev`,
   affected builds, K8s, and Single-VPS according to the root migration rules.
