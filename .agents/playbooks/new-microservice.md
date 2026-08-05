# Playbook: New microservice

Use this checklist for `apps/backend/services/<name>/`. Reference an existing
service with the same runtime. `services.yaml` and ADR-0060 define composition;
ADR-0061 defines when backend code may be shared.

## 1. Decide the boundary first

- Name, responsibility, owners, runtime, and port
- Public gateway route or explicit internal-only status
- Outbound service bindings and their authentication model
- Owned databases/schemas and migration lifecycle
- OpenAPI, Proto, or event contracts
- Build, rollout, rollback, cancellation, and failure behavior

Do not create a service merely to rearrange folders. Do not infer composition
from directories or create a shared library for symmetry.

## 2. Create the service skeleton

Run `./scripts/new-service.sh <name>` for the minimal Python shape, or copy the
closest same-runtime service. During demo phase, do not add test directories,
fixtures, mocks, test configs, or CI test jobs.

For Python, use the repository's resource-oriented layers:

```text
src/
  main.py
  bootstrap/                 # config and dependency wiring
  api/http/routes/           # transport adapters
  application/contracts/     # transport-neutral DTOs
  application/               # use-case orchestration by resource
  domain/                    # only real framework-free invariants
  infrastructure/            # persistence, cache, external clients
  gen_openapi.py
```

Required service-owned files normally include `pyproject.toml` or equivalent,
`.env.example`, `Dockerfile`, and `AGENTS.md`. Add migrations only when the
service owns a database and the task explicitly includes schema work.

## 3. Register one composition graph

Update root `services.yaml` with runtime, port, public routes, outbound
bindings, databases, and optional OpenAPI artifact. Then align these derived
surfaces; do not create a second catalog:

- runtime workspace and `apps/backend/justfile`
- `Procfile.dev`, root dev URLs, and relevant dev scripts
- every service `.env.example` binding URL
- gateway config and route only when public
- `scripts/db-bootstrap.sh` for owned databases
- `infra/k8s/base/<name>` and both overlays
- `infra/single-vps/docker-compose.prod.yml` and DB-init surfaces
- image/deploy workflows
- `docs/微服务/<name>.md` and its index

`scripts/check-services.py` must pass; it checks that the declared service
directories, runtime groups, ports, routes, bindings, K8s, and Single-VPS agree.

## 4. Contracts and boundaries

- Generate OpenAPI into `schemas/openapi/<name>-server.json` when applicable,
  then run root `just sync`.
- Put cross-service Proto and event contracts under `schemas/`.
- Never import another service's source or database.
- Add or reuse a transport client based on generated contracts. A new shared
  implementation requires the ADR-0061 consumer matrix.
- Internal-only does not mean unauthenticated or omitted from deployment.

For Node services, lint/typecheck scripts must invoke the repository tools:
root Oxlint and the explicit `node_modules/@typescript/native/bin/tsc` binary.
Do not use a bare `tsc` or add nested formatter/linter configs.

## 5. Validate the migration

From the repository root:

```text
just install
just up
just sync
just lint
just build
just dev
kubectl kustomize --load-restrictor=LoadRestrictionsNone infra/k8s/overlays/dev
kubectl kustomize --load-restrictor=LoadRestrictionsNone infra/k8s/overlays/prod
docker compose -f infra/single-vps/docker-compose.prod.yml config
```

Run `just fmt` only when explicitly requested or generated/mechanical changes
need it. During demo phase, skip tests. Exercise the real gateway route and at
least one bound internal call; a successful compile alone does not establish
that service composition works.

## Failure patterns to reject

- Service directory exists but is missing from `services.yaml`, or vice versa
- Public route bypasses gateway or an internal service becomes public
- Service imports another service or reads its database
- Local env, K8s, and Single-VPS point one binding at different targets
- Docker build works only for the new service but breaks another workspace image
- A speculative auth/audit/persistence/kernel package is introduced with one
  consumer or no focused architectural decision
- Docs claim a limitation or success that was not exercised with real commands
