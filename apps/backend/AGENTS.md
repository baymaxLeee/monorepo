# Backend Monorepo — Microservices

Python 3.14 + FastAPI, Node.js + TypeScript, and Go services. Root `services.yaml`
is the canonical backend composition graph; it declares runtime, port, public
routes, outbound bindings, owned databases, and optional OpenAPI artifacts.

## Layout

- `services/<name>/` — independently deployable microservice
- `libs/kernel/` — thin Python errors, logging, tracing, and observability
- `libs/kernel-ts/` — thin TypeScript runtime primitives
- `libs/transport-ts/` — generated-contract-based internal HTTP clients

Do not create a shared package for language symmetry. Follow docs/ADR/architecture.md: build a
consumer matrix, choose share implementation / share contract / keep local,
and record high-risk extraction decisions before moving code.

## Hard rules

### Service autonomy

- Each service owns its runtime, dependency manifest, Dockerfile, and data.
- Each service owns its SQL migrations under `services/<name>/migrations/<release>/`.
  The current initial baseline is `v1.0.0/v1.0.0.0.up.sql`.
- Services never import another service's source.
- Cross-service calls use explicit bindings from `services.yaml` and transport
  clients; asynchronous flows use shared event contracts where appropriate.
- A service must not read or mutate another service's database.

### Database migrations

- Preserve existing data in local and deployed databases. Applied SQL, including
  `v1.0.0/v1.0.0.0.up.sql`, is immutable; append new step-prefixed files within the release directory for schema/data changes.
- Steps are contiguous from zero within each three-part release directory.
  Four-part IDs target exact steps; three-part CLI targets select the release head.
  Old three-part database records identify step zero only.
- Each release directory must include a generated `checksums.yaml`. Run root
  `just migrate-checksums <service> <version>` when authoring, then
  `just migrate-check`; never regenerate applied versions to bypass drift.
- Use SQL for schema and simple data changes; use compiled, registered Go
  functions for complex transactional transformations. Never mix SQL and Go in
  one step or run arbitrary Go source during deployment.
- `scripts/db-migrate.sh` and the Goose adapter in `scripts/dbmigrate/` own ordered upgrades, checksum history, serialization
  and transactional rollback. Processes do not create schemas at startup.
- Never reset a database or rewrite checksums to make an upgrade pass. Application
  rollback does not imply schema downgrade. Explicit DOWN requires a verified
  `migrations/<release>/<release>.<step>.down.sql`; missing reverse SQL fails closed. Never reverse
  the initial step `v1.0.0.0`. Preserve data and record irreversible changes explicitly.
- Read [database migrations](../../docs/开发规范/database-migrations.md) for upgrade,
  rollback and backfill contracts. Verify with `just test-db-migrations` and the
  affected service's tests; run `just migrate-up <service>` to apply pending SQL.

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
| `just test [service-or-library] [args...]` | Run isolated pytest, Node test runner, or Go race tests |
| `just lint [service]` | Oxc/TS7 plus scoped or all Python/Node/Go checks |
| `just fmt` | Rewrite supported source using root Oxfmt, Ruff, and gofmt; run only when requested or needed |
| `just gen-openapi <service>` | Export one Python/Node OpenAPI contract |
| `just gen-openapi-all` | Export all registered Python/Node contracts |
| `just migrate-up <svc>` | Apply pending versioned SQL and verify applied checksums |
| `just migrate-down <svc> <target>` | Apply verified reverse SQL to an explicit target |

### TypeScript 7

- `@typescript/native` is the repository code checker. Scripts call
  `node_modules/@typescript/native/bin/tsc` explicitly, never an ambiguous bare
  `tsc`.
- TypeScript 5 remains only for tools that consume its legacy API; ordinary
  packages must not declare it without such a consumer.
- Node tsconfig files explicitly declare `"types": ["node"]`.
- Root Oxlint and Oxfmt are the only JS/TS style configuration.

## Forbidden zones for unprompted edits

- `services/*/migrations/**`
- `**/.env*`

## Done checklist

1. Run the affected service tests, then root `just lint`.
2. If API changed, run root `just sync` and verify both stacks build.
3. Run `just fmt` only when explicitly requested or mechanical drift requires it.
4. If a shared capability changed, list every consumer and verify each one.
5. If composition changed, validate `just install`, `just up`, `just dev`,
   affected builds, K8s, and Single-VPS according to the root migration rules.

## Tests are part of implementation

After changing code, run root `just test-affected HEAD backend` or
`just test backend/<service-or-library>` (or
`just test <name>` here). Run `just test backend` from root when changing
backend-wide tooling. CI calls the same root CLI and discovers every service
and library; a target with no test files fails.

- Go: colocate `*_test.go`; the CLI runs `go test -race ./...`.
- Node: colocate `src/**/*.test.ts`; use `node:test` and `node:assert/strict`.
  Each package exposes `pnpm test` using Node with the existing tsx loader.
- Python: colocate `test_*.py` under `src`; use pytest and pytest-asyncio.
  Each project owns its pytest import path and asyncio configuration. Services
  run in separate processes because their top-level package names overlap.
- Keep unit tests independent of running databases, local `.env` values, paid
  models and external services. Test integration behavior separately against
  the real boundary; mocks cannot prove transaction or transport correctness.
- Start defect fixes with a reproducing regression test; add failure-path
  coverage for lifecycle and authorization changes. Never suppress collection
  failures or use an empty smoke assertion to satisfy the gate.

See `docs/开发规范/testing.md` for the shared policy.
