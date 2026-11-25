# Backend services

Python, TypeScript and Go services are independently deployable. Root
[`services.yaml`](../../services.yaml) is the composition authority for runtime,
ports, public routes, outbound bindings, owned databases and OpenAPI artifacts.
Use root `just` commands; start with `just context <service-or-path>`.

## Service and data boundaries

- Each service owns its runtime, dependency manifest, Dockerfile, database and
  migrations. Services never import another service's source or read its database.
- Use the transport declared by `services.yaml`: typed business RPC uses
  Proto/gRPC, HTTP/streaming/MCP boundaries retain their native protocol and
  asynchronous flows use shared event contracts.
- Cross-service and cross-stack wire contracts belong in `schemas/`. Generated
  bindings are infrastructure; domain models remain service-local.
- Gateway is the only public backend edge. Runtime server, worker and sandbox
  roles remain internal. Service-specific edge behavior belongs in Gateway's
  closest AGENTS, not in this stack entry point.

## Application architecture

Follow the current [architecture decision](../../docs/ADR/architecture.md).

- Dependencies point `api -> application -> domain`; infrastructure implements
  small ports owned by its application consumer. Application and domain never
  import concrete adapters.
- Entrypoints only establish process cancellation, invoke one bootstrap role and
  report its terminal result. `bootstrap` is the sole composition and lifecycle
  root; do not add a second generic `app` layer, service locator or reflection DI.
- Keep business resources explicit across transport, orchestration, optional
  domain policy and persistence. Do not create placeholder domain modules for
  CRUD-only resources or merge unrelated resources into generic CRUD layers.
- Long-running roles share one cancellation context. Stop admission, drain
  servers/workers, close adapters and flush telemetry in that order; child tasks
  never terminate the process directly.
- `libs/` contains proven infrastructure capabilities, never domain models. A
  shared implementation needs two real consumers or a documented reason that a
  security/protocol capability must be centralized. Do not create packages for
  language symmetry.

## Database changes

Follow the [migration contract](../../docs/开发规范/database-migrations.md).

- Applied migration source, checksum history and persistent developer databases
  are immutable history. Never edit migration tables or reset data to pass an
  upgrade.
- Unless the user opens a new release, append the next contiguous step to the
  service's latest existing three-part release. Inspect repository releases and
  any reachable database head before assigning the ID.
- Generate and review `checksums.yaml` with
  `just migrate-checksums <service> <version>`; run `just migrate-check` and the
  affected migration/service tests. Apply pending steps to a reachable persistent
  development database with `just migrate-up <service>` when available.
- Use SQL for schema and bounded data changes. Complex transactional Go
  transformations must be compiled and registered; never execute arbitrary source
  during deployment or mix SQL and Go in one step.

## Language platforms

- Go services follow the [Go platform decision](../../docs/ADR/go-service-platform.md).
  `go-platform.json`, `go.work` and each independently valid `go.mod` own choices
  and versions. Do not add a competing platform library. Keep modules valid under
  `GOWORK=off go mod tidy -diff`; regenerate sqlc output after query changes.
- Node services use the repository TS7 checker and root Oxc configuration. Do not
  add service-local ESLint/Prettier or DOM libraries to make Node types pass.
- Python services use root Ruff and per-project strict mypy. Do not add Black,
  isort or service-local lint configuration. Services are checked separately
  because top-level package names may overlap.

## Adding or changing integration

- New services follow the
  [microservice playbook](../../.agents/playbooks/new-microservice.md). The change
  is integrated only when `services.yaml`, workspaces, local development,
  contracts, Gateway when public, Kubernetes, Single-VPS, CI and docs agree.
- Contract changes run root `just sync` and verify the producer, transport and all
  consumers. Never hand-edit generated OpenAPI, Proto, sqlc or client output.
- One-shot seed, migration and backfill jobs use distinct role entrypoints. Long
  backfills need checkpoints, idempotency and reconciliation outside DDL
  transactions.

## Verification

Run `just test backend/<service-or-library>` or the target reported by
`just context`; use `just test-affected HEAD backend --list` to preview affected
suites. Run the affected build when entrypoints, packaging or deployment output
changes. Backend-wide runner/discovery changes require root `just test`.

Colocate Go `*_test.go`, Node `*.test.ts` and Python `test_*.py` with the owner.
Unit tests must not depend on local `.env`, paid models or running databases;
verify SQL, transactions, transports and migrations separately against their real
boundaries. Missing or skipped integration tests are unverified. Shared testing
policy lives in [testing.md](../../docs/开发规范/testing.md).
