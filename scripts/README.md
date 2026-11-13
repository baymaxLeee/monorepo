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
just context frontend/@repo/ai-elements
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
  For a single target use `just test frontend/@repo/ai-elements`.
- Dependency and consumer results describe declared workspace dependencies.
  Trace HTTP, events and runtime federation consumers separately. `check-repo`
  does not inspect source imports, validate document claims or run application
  tests; use the routed checks and root verification policy as well.
- A successful preview is not a test pass. Missing suites, skipped tests and
  unavailable dependencies remain unverified. Selection fallbacks and runner
  policy are specified in the [test policy](../docs/开发规范/testing.md).

## Code quality and staged checks

Run from the repository root. Commands call the official tools directly;
frontend, backend, local development, agents and CI use the same root configs.

| Command | Scope and behavior |
|---|---|
| `just lint-ts` | Oxlint + Oxfmt check for all JS/JSX/TS/TSX/MTS/CTS, including Node backend, build config and scripts |
| `just typecheck-ts` | TS7 checks in both Node and frontend workspaces |
| `just fmt-ts` | Oxfmt writes for the same source scope |
| `just lint-py [paths/flags...]` | Ruff lint, including scripts and infrastructure; accepts native `--fix` / `--output-format json` |
| `just fmt-py --check [paths...]` | Ruff format check; omit `--check` to write, or use `--diff` to preview |
| `just check-py` | Ruff lint + format check and per-project strict mypy |
| `just pre-commit` | Check the staged snapshot, including partially staged files, without modifying it |
| `just pre-commit --all-files` | Audit all tracked source files, useful after changing quality configuration |
| `just lint` | All language checks, typechecks, boundaries and repository checks |

Scoped examples: `just lint-py apps/backend/services/knowledge`,
`just fmt-py --diff scripts/check-services.py`, and
`pnpm lint:ts apps/backend/services/chat`. For a single JS/TS file, use
`pnpm exec oxfmt --check <path>` or `--write` with the same root config.
Python tools are locked by `apps/backend/uv.lock`; Oxc by root `pnpm-lock.yaml`.
Generated code and migrations stay excluded, including staged explicit paths.

The root lint config defaults to Node. Browser app/package sources reject Node builtin imports
(including literal dynamic imports, `require`, re-exports and type imports) and
ambient Node globals; locally declared bundler constants remain valid. Frontend
test/spec files and `test`/`tests`/`__tests__` directories allow Node plus jsdom.
JavaScript checks undefined globals with Oxlint; TypeScript uses TS7. Node
tsconfigs exclude DOM while retaining native web APIs through Node types.
Tooling regression tests need both root lint tools and the frontend workspace's
TS7 checker (`just install` installs both); CI installs that workspace selectively.

`.pre-commit-config.yaml` uses local hooks to reuse those installed tools;
`just install` installs the dependencies. Checks are read-only. After an explicit
fix, review and re-stage changes before rerunning. Typechecks and behavior tests
remain required separately; staged checks do not replace CI.

To enable automatic checks on machines without managed hooks, run the official
`uv run --locked --project apps/backend pre-commit install`. Do not unset or
replace an existing managed `core.hooksPath`; use `just pre-commit` explicitly
there, or have the hook owner integrate the command.

## Local CI and verified push

`just ci-code [base]` is the canonical code gate shared by the local verifier
and the `build-images` GitHub workflow. It owns frozen dependency installation,
static checks, affected behavior tests, contract consistency and application
builds. GitHub and local push verification therefore execute the same command
graph; only the operating system and available machine resources can differ.
For ordinary project source changes it resolves the owner and declared transitive
consumers. Format and source lint receive only changed files; typechecks, tests and
builds run for the affected owners and consumers. Cross-stack Chat stream contracts map directly to their Chat producer
and consumers instead of selecting the repository. Documentation and repository
tooling changes use repository/tooling checks only. Project manifests stay with
their owner and declared consumers. Unmapped stack/global configuration, contracts
and other unknown impact fall back to the corresponding stack or full gate because
a narrower result would be unreliable.

`just ci-plan [base]` prints JSON with the resolved merge base, all changed files
(including committed work) and exact commands. `just ci [base]` runs the same
push gate sequentially with `CI=true`, stops on the first failure and writes logs plus
`result.json` under the worktree's Git directory (`git rev-parse --git-path agent-ci`).
The default base is `origin/main`; fetch it first when using these diagnostic
commands. Missing bases fail closed. Results are diagnostic evidence, never a
reusable push permission.

The code gate uses frozen pnpm installs in all three workspaces and locked uv
sync, read-only Go module consistency (`just check-go-modules`), root lint
(including format/type checks), affected tests, contract generation checks, and
frontend/backend builds. Executable tooling edits run root tests once instead of
the equivalent full affected selection.
Migration-related edits add disposable PostgreSQL integration tests. Production
image builds are intentionally not part of `just push`: GitHub builds affected
images on native `linux/amd64` after the code gate. Use `just ci-release-plan`
and `just ci-release` only when explicitly validating image or release-pipeline
changes locally; they build affected images for the local native Linux architecture
with `--load`, without publishing. This avoids treating Apple Silicon QEMU faults
as application failures. Protobuf changes additionally require local `buf` lint,
format and breaking checks. Documentation-only diffs run repository and tooling checks.
Agent/editor instructions, lint/format/pre-commit configuration and tooling workflows
also reuse existing immutable images; when mixed with runtime source, they do not widen
the source-derived image set.
GitHub jobs use the pinned Ubuntu 24.04 image; Node, pnpm, Python, uv, Go, just
and Buf versions come from `mise.toml`. Docker/buildx and that pinned toolchain
must be available locally. The
command installs dependencies and may regenerate contracts/build output; it does
not auto-fix source. Changes to tracked or untracked source during checks fail
the run. Existing empty-suite policy is preserved, including failures for selected
projects without tests; a broader suite's UNTESTED notice is not coverage.

Agent procedure:

1. Locate the owner with `just context`, state observable acceptance criteria and
   protected invariants, and reproduce a bug with a failing behavior test.
2. Implement and run focused tests during development. Apply scoped Oxfmt,
   Ruff or gofmt fixes, inspect the diff, and preserve unrelated changes. Use
   `just fmt` only when the entire formatting scope belongs to the task.
3. Run `just ci-plan origin/main`, then `just ci origin/main`. Use
   `just ci-release-plan origin/main` and `just ci-release origin/main` only for
   explicit image/release-pipeline work. Read the first
   failed step's log, fix its cause and repeat. Do not remove assertions, add
   skips, relax timeouts without diagnosis, or suppress an empty suite. Missing
   tools/services are blockers to verification, not passing results.
4. Review the complete diff against the requirement, including consumers and
   failure/cleanup paths. Stage only task files and run `just pre-commit` before
   an authorized commit. Generated-contract differences need review and commit;
   `sync-check` compares generated files with Git, including intended changes.
5. For an authorized push run `just push origin <current-branch>`. This requires
   a clean tree, fetches remote main and destination, rejects a branch behind
   main or a diverged destination, and runs the release gate again on clean HEAD.
   It checks source/HEAD and remote refs again, then pushes a single fixed SHA.
   Failures never execute push. New feature branches are supported. Main is the
   repository integration branch; custom release destinations are not supported.
6. Inspect GitHub Actions for that SHA with `gh run list --commit <sha>` and
   `gh run view <id> --log-failed`. Fix the first failed dependency before
   retrying downstream workflows. Report local results separately from image
   publication, mirroring and deployment.

`just push` deliberately reruns checks after commit: previous diagnostic runs
may have used uncommitted files, older dependencies or a stale remote base. It
never stashes, commits, force-pushes or replaces company-managed Git hooks.
Concurrent checks in the same worktree are rejected. If a process is killed,
confirm it has stopped before removing the Git-local `agent-ci/lock` directory;
rerun the gate from the start. Logs may contain application test output; keep
them local and review before sharing.

This CLI cannot prevent someone from invoking raw Git or editing the gate.
For enforcement across clients, configure remote branch rules requiring PRs and
successful checks, restrict bypass permissions, and have the managed hook owner
integrate the gate if required. These external settings are not changed by the
CLI. Local checks cannot prove registry credentials, mirror connectivity or
production deployment success. Remote CI remains authoritative for those steps;
service-specific end-to-end checks must also follow their owning routes.

### Registry mirror recovery

`mirror-images` normally copies only rebuilt immutable images and retags reused
digests. If cross-region registry access makes that unreliable, publish the exact
clean local commit directly to the domestic registry instead of downloading
images from GHCR.

Commit and verify the intended change first. After confirming Docker is
authenticated to the target registry, run:

```bash
just publish-images-local \
  <domestic-registry>/<namespace> \
  sha-<current-HEAD8> \
  [service ...] \
  --alias main
```

The command rejects dirty worktrees and tags that do not identify current HEAD.
It uses the same contexts and Dockerfiles as `build-images`, builds `linux/amd64`
locally, pushes immutable images directly to the target with bounded retries, and
verifies each published digest. It publishes aliases only after the whole requested
immutable set verifies, using an in-registry retag so layers are not uploaded
twice. Re-running is resumable: existing immutable tags are skipped. It reads
existing Docker credentials and never accepts credentials as arguments. Push the
matching commit afterward and observe the GitHub build, mirror and deploy workflows;
local publication alone is not deployment success.

For reliable builds from mainland China, the local command supplies domestic Go
and Debian mirrors while every Dockerfile keeps its official default for CI.
Override them when needed with `LOCAL_IMAGE_GOPROXY`, `LOCAL_IMAGE_GOSUMDB`,
`LOCAL_IMAGE_DEBIAN_MIRROR`, `LOCAL_IMAGE_NPM_REGISTRY`, and
`LOCAL_IMAGE_COREPACK_NPM_REGISTRY`; these variables must contain repository
endpoints, never credentials. Corepack defaults to the official npm registry
because mirrors that return relative tarball URLs are not Corepack-compatible.

The design applies [OpenAI Codex testing and review guidance](https://learn.chatgpt.com/guides/best-practices#improve-reliability-with-testing-and-review)
and [Claude Code's distinction between instructions and enforced checks](https://code.claude.com/docs/en/best-practices).
Acceptance-driven iteration and resumable evidence follow
[Anthropic's agent harness guidance](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
Repository commands enforce pass/fail; the agent diagnoses and repairs failures.

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
  clears local Storage bytes. No business data or account rows are preserved; the
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
