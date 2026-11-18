# Backend Monorepo — Microservices

Python 3.14 + FastAPI, Node.js + TypeScript, and Go services. Root `services.yaml`
is the canonical backend composition graph; it declares runtime, port, public
routes, outbound bindings, owned databases, and optional OpenAPI artifacts.

## Layout

- `services/<name>/` — independently deployable microservice
- `libs/inner-api-{go,ts,py}/` — generated cross-stack gRPC bindings and protocol runtime

Do not create a shared package for language symmetry. Follow docs/ADR/architecture.md: build a
consumer matrix, choose share implementation / share contract / keep local,
and record high-risk extraction decisions before moving code.

## Hard rules

### Service autonomy

- Each service owns its runtime, dependency manifest, Dockerfile, and data.
- Each service owns its SQL migrations under `services/<name>/migrations/<release>/`.
  The current initial baseline is `v1.0.0/v1.0.0.0.up.sql`.
- Services never import another service's source.
- Cross-service calls use Proto/gRPC bindings declared by `services.yaml`;
  asynchronous flows use shared event contracts where appropriate.
- A service must not read or mutate another service's database.

### Database migrations

- Preserve existing data in local and deployed databases. Applied SQL, including
  `v1.0.0/v1.0.0.0.up.sql`, is immutable; append new step-prefixed files within the release directory for schema/data changes.
- Steps are contiguous from zero within each three-part release directory.
  Four-part IDs target exact steps; three-part CLI targets select the release head.
  Old three-part database records identify step zero only.
- Append the next contiguous step to the latest existing release directory by
  default. Never create a new major, minor or patch migration release unless the
  user explicitly says they have opened that version.
- Before assigning a migration ID, inspect every release directory for that
  service and, when the database is available, query `public.migration` for its
  current head. The new ID must sort after both the repository's highest step
  and every known applied head; never insert a step into an older release. If a
  database has already passed the intended position, append the next step to
  the latest opened release instead of editing history or checksums.
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
- `runtime` remains internal-only; its server, worker and sandbox roles are never public gateway targets.

### Resource boundaries

- Keep business resources separate end-to-end: transport DTO, application
  orchestration, optional domain policy, persistence model, and repository.
- `domain/` contains framework-independent invariants and deterministic state
  transitions. It must not import API, application, infrastructure, ORM, HTTP,
  or runtime SDK modules.
- Do not create placeholder domain modules for CRUD-only resources.
- Do not merge unrelated resources into generic CRUD/model/schema modules merely
  to reduce boilerplate.

### Application host and dependency direction

- Entrypoints are thin: create the process cancellation context, call one
  `bootstrap` role, report its terminal error and set the exit code. They do not
  construct routers, repositories, clients or background workers.
- `bootstrap` is the sole composition root and lifecycle owner. Do not create a
  second generic `app` layer with overlapping ownership.
- Dependencies point `api -> application -> domain`. Infrastructure implements
  small ports defined by its application consumer; application and domain never
  import concrete adapters.
- Complex services split assembly by business capability and process role, then
  aggregate explicit module bindings in bootstrap. Do not use reflection DI,
  service locators or one unbounded wiring file.
- One-shot seed/backfill commands use their own entrypoint. Long-running roles
  share one cancellation context and shut down admission, HTTP/workers,
  adapters and telemetry in that order. Child goroutines never call `os.Exit`.

### Shared capability discipline

- `libs/` contains infrastructure capabilities only; never domain models.
- A shared implementation needs at least two real consumers, or a
  must-centralize security/protocol reason documented in an ADR.
- Auth, persistence, and crypto are separate high-risk decisions. Do not bundle
  them into a mega-kernel or create `auth_sdk`, `audit_sdk`, `transport-py`, or
  a Go kernel speculatively.
- Never add `libs/utils/` or share Pydantic domain DTOs across services.

### Go platform

- Follow [`docs/ADR/go-service-platform.md`](../../docs/ADR/go-service-platform.md).
  [`go-platform.json`](go-platform.json) is the executable capability/version
  catalog; adding a competing library for an existing capability is forbidden.
  `go.work` owns workspace membership and the exact toolchain; each service or
  library keeps an independently valid `go.mod`.
- Shared direct dependencies use one version across every workspace module.
  Update all consumers together, run `go work sync`, and keep every module
  clean under `GOWORK=off go mod tidy -diff`; do not use `replace` as a version catalog.
- PostgreSQL code uses `pgx/v5`; static SQL defaults to checked-in queries plus
  generated `sqlc` types. Raw pgx is limited to genuinely dynamic query shapes.
  Keep domain repositories service-local and generate typed queries from versioned SQL.
- Go process configuration uses typed structs and startup validation. HTTP and
  gRPC entrypoints propagate context, cancellation and OpenTelemetry through the
  shared infrastructure capability; services retain ownership of semantic spans.
- Every Go service directly uses the catalogued config, Chi, observability and
  HTTP tracing dependencies. Domain-only libraries remain service-local and may
  not replace a catalogued platform capability.
- Pin stable generator versions in recipes. Run `just gen-sql <service>` after
  changing SQL queries and `just gen-sql-all` for the complete generated set.

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
| `just gen-sql <service>` | Regenerate one service's checked-in sqlc output |
| `just gen-sql-all` | Regenerate all registered sqlc outputs |
| `just migrate-up <svc>` | Apply pending versioned SQL and verify applied checksums |
| `just migrate-down <svc> <target>` | Apply verified reverse SQL to an explicit target |

### TypeScript 7

- `@typescript/native` is the repository code checker. Scripts call
  `node_modules/@typescript/native/bin/tsc` explicitly, never an ambiguous bare
  `tsc`.
- TypeScript 5 remains only for tools that consume its legacy API; ordinary
  packages must not declare it without such a consumer.
- Node tsconfig files explicitly declare `"types": ["node"]`.
- Set Node `lib` to the project's ES standard library only, without DOM;
  Node's own types provide supported fetch, Response, Blob and stream APIs.
  Import extra stream types from `node:stream/web` and derive fetch option
  types from `RequestInit` instead of adding DOM to make a typecheck pass.
- Root Oxlint and Oxfmt are the only JS/TS style configuration.
- Frontend, Node services, libraries, build configuration and repository scripts
  share the root policy. `just lint-ts` checks lint and format; `just typecheck-ts`
  runs both stacks' TS7 checks. Scoped package commands use the same root tools.

### Python quality

- Root `ruff.toml` is the single Python lint/format configuration, including
  repository and infrastructure scripts. Do not add Black, isort or another
  Ruff configuration. Migrations remain excluded even for explicit file paths.
- Use root `just lint-py [paths/flags...]`, `just fmt-py --check [paths...]` and
  `just check-py`. Native `--fix` and format without `--check` are explicit writes.
- Keep strict mypy per Python project: services reuse top-level package names
  and must be checked in separate processes. Ruff does not replace typechecking.
- CI and staged hooks use tools locked in `uv.lock`; root `just pre-commit`
  checks the staged snapshot without rewriting files or installing Git hooks.

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
