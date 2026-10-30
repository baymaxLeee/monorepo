# Scripts

These scripts are implementation details behind root `just` recipes. Prefer
running `just <recipe>` from the repository root.

## Agent command guide

| When | Command | Result |
|---|---|---|
| Find a project or its exact target ID | `just repo-map [--json]` | Manifest-derived IDs, paths, runtimes and direct declared dependencies |
| Before editing a known path or target | `just context <path-or-target> [--json]` | Owner, root-to-leaf AGENTS paths, relevant document routes, direct dependencies, transitive consumers and suggested test commands |
| After changing project structure, dependencies or documentation links | `just check-repo` | Checks the declared project graph and routed Markdown link destinations; exits nonzero on errors |
| Find runnable suites and coverage gaps | `just test-list` | Test target IDs and missing suites |
| Preview tests affected by the working changes | `just test-affected HEAD all --list` | Selected targets only; does not execute tests |
| Run the selected affected tests | `just test-affected HEAD all` | Native test runners and their results |

Start with `repo-map` if the owner is unknown, then use `context` and read its
listed instructions before editing. For example:

```bash
just context frontend/@repo/chat
just context apps/backend/services/chat/src/application/agent --json
just context scripts/repo.mjs
just test-affected HEAD frontend --list
```

- Use exact target IDs from `repo-map`; frontend shared packages keep `@repo/`.
  Context also accepts repository paths, including files not yet created.
  A path outside a discovered project has no project owner; follow its directory
  instructions and the returned repository checks.
- `--json` is available on `repo-map` and `context` for structured consumption.
  Context prints instruction paths, not their contents; it does not run tests.
- `test-affected [base] [scope] [--list]` defaults to `HEAD` and `all`.
  Scope is `all`, `frontend`, `backend` or `tooling`, not an individual target.
  Supply both positional arguments before `--list`. HEAD includes staged,
  unstaged and untracked changes; use the PR base SHA to include committed work.
  For a single target use `just test frontend/@repo/chat`.
- Dependency and consumer results describe declared workspace dependencies.
  Trace HTTP, events and runtime federation consumers separately. `check-repo`
  does not inspect source imports, validate document claims or run application
  tests; use the routed checks and root verification policy as well.
- A successful preview is not a test pass. Missing suites, skipped tests and
  unavailable dependencies remain unverified. Selection fallbacks and runner
  policy are specified in the [test policy](../docs/开发规范/testing.md).

## Lifecycle

- `install-deps.sh`: installs tool-managed dependencies, frontend packages,
  backend Python workspace packages, Go service modules, and local `.env` files.
- `db-bootstrap.sh`: creates every service-owned PostgreSQL database/role,
  applies pending versioned SQL without discarding data, seeds Admin configuration, and
  bootstraps the IAM super-admin.
- `db-migrate.sh`: validates immutable SQL history and applies pending versions in
  one locked transaction; root `just migrate-up <service> [target]` and explicit
  `just migrate-down <service> <target>`. SQL lives in `migrations/<release>/<release>.<step>.up.sql`
  and optional `down.sql`;
  missing reversals fail closed. `migration_audit` retains UP/DOWN execution checksums.
- `db-checksums.sh`: explicit per-version manifest generation and read-only catalog
  verification through `just migrate-checksums` / `just migrate-check`.
- `dbmigrate/`: pinned Goose transaction execution with the repository version-directory
  and checksum adapter. Registered service Go migrations share the SQL transaction
  and ledger; `just test tooling` includes its Go unit tests.
- `tests/test-db-migrate.py`: disposable PostgreSQL integration tests for upgrades
  and failure recovery; root `just test-db-migrations`.
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

## Tests

- `test.mjs`: dispatches root `just test [target] [args...]` to native Go/Node,
  pytest and frontend Vitest. `just test-list` lists targets and empty suites.
- `test-cli.test.mjs`: exercises discovery, scoping, empty suites and failure
  propagation; run `just test tooling`.
- `test-affected.mjs`: powers `just test-affected [base] [scope] [--list]`.
  The default base is HEAD; tracked and untracked local edits are included.
  Node package edits select the owner and transitive declared consumers;
  manifests, unresolved dependencies and Python/Go shared libraries select their
  stack. Global configuration or an unavailable base selects all scopes.
  `test-affected.test.mjs` verifies selection and Git change discovery.

## Repository context

- `repository.mjs`: discovers owners and Node dependency edges from existing
  manifests; shared by test discovery, impact selection and context queries.
- `repo.mjs`: powers `just repo-map [--json]`,
  `just context <path-or-target> [--json]` and `just check-repo`. Context lists
  AGENTS from root to leaf without loading source or environment contents.
  Checks reject unresolved local dependencies, cycles, dependencies on deployable
  apps/services and broken documentation navigation links. Source import/tag
  enforcement remains with the native stack checks.

## Helpers

- `build-target.sh`: dispatches root `just build [target]` to frontend/backend
  build recipes.
- `wait-for-postgres.sh`: waits until the local PostgreSQL container accepts pings.
- `wait-for-url.sh`: waits for an HTTP endpoint, used for MFE startup ordering.

## Scaffolding

- `new-service.sh`: creates a Python service skeleton.
- `new-mfe.sh`: creates a Module Federation remote skeleton.
- `worktree.sh`: creates a git worktree for truly parallel agent processes.
