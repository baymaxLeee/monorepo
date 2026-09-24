# Scripts

These scripts are implementation details behind root `just` recipes. Prefer
running `just <recipe>` from the repository root.

## Lifecycle

- `install-deps.sh`: installs tool-managed dependencies, frontend packages,
  backend Python workspace packages, Go service modules, and local `.env` files.
- `db-bootstrap.sh`: creates every service-owned PostgreSQL database/role,
  applies its reinstall-only `v1.0.0` baseline, seeds Admin configuration, and
  bootstraps the IAM super-admin.
- `reset-demo-data.sh`: destroys and recreates every local service database and
  clears local Asset bytes. No business data or account rows are preserved; the
  configured IAM super-admin is seeded again.
- `dev-preflight.sh`: checks that local infra and frontend dependencies exist
  before starting the dev stack, including caller/receiver service credentials.
- `sync-dev-service-identities.py`: safely migrates the retired shared local
  token and validates per-caller credentials without overwriting custom values.
- `dev-orchestrator.sh`: starts `Procfile.dev` with an installed process
  manager, falling back to `dev-stack.sh`.
- `dev-stack.sh`: shell fallback for starting the local demo stack.
- `doctor.sh`: checks required tools and local Docker services.

## Helpers

- `build-target.sh`: dispatches root `just build [target]` to frontend/backend
  build recipes.
- `wait-for-postgres.sh`: waits until the local PostgreSQL container accepts pings.
- `wait-for-url.sh`: waits for an HTTP endpoint, used for MFE startup ordering.

## Scaffolding

- `new-service.sh`: creates a Python service skeleton.
- `new-mfe.sh`: creates a Module Federation remote skeleton.
- `worktree.sh`: creates a git worktree for truly parallel agent processes.
