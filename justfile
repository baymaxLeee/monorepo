set positional-arguments
set shell := ["bash", "-cu"]

# Default: list commands
default:
    @just --list

# ─── Lifecycle ──────────────────────────────────────────────
# Start full local infra, including the observability stack.
up:
    @just up-sandbox
    docker compose --profile observability --profile sandbox up -d --remove-orphans
    @./scripts/wait-for-postgres.sh
    @./scripts/workflow-postgres-bootstrap.sh
    @./scripts/db-bootstrap.sh
    @echo "OK Infra up - Redis :6379, Postgres :5432, ClickHouse :8123, OTLP :4318"

up-core:
    @just up-sandbox
    docker compose --profile sandbox up -d --remove-orphans
    @./scripts/wait-for-postgres.sh
    @./scripts/workflow-postgres-bootstrap.sh
    @./scripts/db-bootstrap.sh
    @echo "OK Core infra up - Redis :6379, Postgres :5432 (workflow + service DBs + knowledge vectors)"

up-observability:
    @just up

# Prepare local execution images and the isolated network proxy.
up-sandbox:
    @just build-sandbox-runtime
    docker compose --profile sandbox up -d --build sandbox-proxy

reset-demo-data:
    @./scripts/reset-demo-data.sh

# Apply pending migrations without resetting data. Empty target means latest.
migrate-up service target="":
    @db="{{ service }}"; \
    DATABASE_NAME="${DATABASE_NAME:-$db}" DATABASE_USER="${DATABASE_USER:-$db}" DATABASE_PASSWORD="${DATABASE_PASSWORD:-$db}" \
    bash scripts/db-migrate.sh "apps/backend/services/{{ service }}" "{{ target }}"

# Explicit schema downgrade; refuses missing or unsafe reverse migrations.
migrate-down service target:
    @db="{{ service }}"; \
    DATABASE_NAME="${DATABASE_NAME:-$db}" DATABASE_USER="${DATABASE_USER:-$db}" DATABASE_PASSWORD="${DATABASE_PASSWORD:-$db}" \
    bash scripts/db-migrate.sh "apps/backend/services/{{ service }}" "{{ target }}" down

# Generate a version manifest explicitly; never updates database history.
migrate-checksums service version:
    @bash scripts/db-checksums.sh write "{{ service }}" "{{ version }}"

migrate-check:
    @bash scripts/db-checksums.sh check

# Integration tests create and remove their own disposable PostgreSQL container.
test-db-migrations:
    @python3 scripts/tests/test-db-migrate.py

down:
    docker compose --profile observability --profile sandbox down

# Install all deps (mise, pnpm, uv, go). Does not start Docker.
install:
    @./scripts/install-deps.sh

# ─── Dev ────────────────────────────────────────────────────
# Prereq: `just up` first. Run `just dev-urls` for the complete service and MFE URL list.
dev:
    @just dev-preflight
    @./scripts/dev-orchestrator.sh

dev-preflight:
    @./scripts/dev-preflight.sh

dev-shell:
    @just dev-preflight
    @./scripts/dev-stack.sh

dev-urls:
    @echo "  storage:    http://localhost:8013/healthz"
    @echo "  sandbox:  http://localhost:8014/healthz"
    @echo "  canvas: http://localhost:8012/healthz; mfe-canvas: http://localhost:3006"
    @echo "  platform:  http://localhost:3000"
    @echo "  mfe-admin: http://localhost:3001"
    @echo "  mfe-chat:  http://localhost:3005"
    @echo "  gateway:   http://localhost:8000"
    @echo "  telemetry: http://localhost:8008/healthz"
    @echo "  iam:      http://localhost:8002/healthz"
    @echo "  knowledge: http://localhost:8010/healthz"
    @echo "  executor:  http://localhost:8011/healthz"
    @echo "  svc-admin: http://localhost:8001/docs"
    @echo "  svc-chat:  http://localhost:8009/docs"

# ─── Build ──────────────────────────────────────────────────
# Usage: build [target]  target = frontend | backend | platform | admin | gateway | ...
build target="":
    @./scripts/build-target.sh "{{ target }}"

# Keep Web development independent; explicitly opt into the Electron host.
[positional-arguments]
desktop-dev *args:
    pnpm --dir apps/frontend/apps/desktop launch "$@"

[positional-arguments]
desktop-package *args:
    pnpm --dir apps/frontend/apps/desktop package "$@"

build-frontend:
    @echo "Building frontend..."
    cd apps/frontend && just build

build-backend:
    @echo "Building backend Go and Node services..."
    cd apps/backend && just build-go && just build-node

build-images registry="local" tag="latest":
    cd apps/backend && just build-images {{ registry }} {{ tag }}

# Build the ephemeral sandbox execution image used by Docker and Kubernetes.
build-sandbox-runtime registry="local" tag="latest":
    docker build -t {{ registry }}/sandbox-runtime:{{ tag }} -f apps/backend/services/sandbox/runtime/Dockerfile .

# ─── Cross-stack ────────────────────────────────────────────
sync:
    node schemas/codegen/generate-chat-ui.mjs
    node schemas/codegen/generate-desktop.mjs
    cd apps/backend && just gen-openapi-all
    cd apps/frontend && just gen-client
    cd apps/backend && just gen-transport-ts
    @echo "OK Schema synced"

# Add official AI Elements sources, e.g. ai-add @ai-elements/message --dry-run.
ai-add *args:
    @pnpm --dir apps/frontend/packages/ai-elements ui:add "$@"

# Add shadcn Base components, e.g. ui-add button --dry-run.
ui-add *args:
    @pnpm --dir apps/frontend/packages/design-system ui:add "$@"

# One JS/TS policy for frontend, Node services and repository scripts.
lint-ts:
    pnpm lint:ts oxlint.config.ts oxfmt.config.ts scripts apps/frontend apps/backend
    pnpm format:ts:check

fmt-ts:
    pnpm format:ts

typecheck-ts:
    cd apps/backend && just typecheck-node
    pnpm --dir apps/frontend typecheck

# Native Ruff arguments, including paths, --fix, --check and --diff.
lint-py *args:
    @uv run --locked --project apps/backend ruff check "$@"

fmt-py *args:
    @uv run --locked --project apps/backend ruff format "$@"

check-py:
    @just lint-py
    @just fmt-py --check
    cd apps/backend && just typecheck-python

# Checks the staged snapshot; --all-files is available for a full audit.
pre-commit *args:
    @uv run --locked --project apps/backend pre-commit run "$@"

fmt:
    @just fmt-ts
    @just lint-py --fix
    @just fmt-py
    cd apps/backend && just fmt-go

lint:
    @just check-repo
    @just migrate-check
    cd scripts/dbmigrate && GOWORK=off go vet ./...
    @uv run --project apps/backend python scripts/check-services.py
    @just lint-ts
    @just check-py
    @just typecheck-ts
    cd apps/backend && just lint-go
    pnpm lint:ui-contracts
    cd apps/frontend && just boundaries

# Run all tests, or one target from test-list; trailing arguments go to that runner.
test *args:
    @node scripts/test.mjs "$@"

# Run tests affected by changes since base, including local uncommitted changes.
test-affected base="HEAD" scope="all" *args:
    @node scripts/test-affected.mjs "$@"

# List test target IDs and missing suites.
test-list:
    @node scripts/test.mjs --list

# List project IDs, paths, runtimes and dependencies; accepts --json.
repo-map *args:
    @node scripts/repo.mjs map "$@"

# Locate owner, AGENTS chain, consumers and test commands: <path-or-target> [--json].
context *args:
    @node scripts/repo.mjs context "$@"

# Validate declared project dependencies and documentation navigation links.
check-repo:
    @node scripts/repo.mjs check

# Read-only equivalent of CI's Go dependency consistency check.
check-go-modules:
    @node scripts/local-ci.mjs go-modules

# Preview or run local release checks, including committed changes since base.
ci-code base="origin/main":
    @node scripts/local-ci.mjs code "$@"

ci-plan base="origin/main":
    @node scripts/local-ci.mjs plan "$@"

ci base="origin/main":
    @node scripts/local-ci.mjs check "$@"

ci-release-plan base="origin/main":
    @node scripts/local-ci.mjs release-plan "$@"

ci-release base="origin/main":
    @node scripts/local-ci.mjs release "$@"

# Verify a clean commit against fresh remote main, then push that exact SHA.
push remote="origin" branch="":
    @node scripts/local-ci.mjs push "$@"

# Aggregate static checks, behavior tests, and generated contract consistency.
check:
    @just lint
    @just test
    @just sync-check

sync-check:
    node schemas/codegen/generate-chat-ui.mjs --check
    node schemas/codegen/generate-desktop.mjs --check
    cd apps/backend && just gen-openapi-all
    cd apps/backend && just gen-transport-ts
    cd apps/frontend && just gen-client
    @git diff --exit-code schemas/openapi/ apps/backend/libs/transport-ts/src/schema/ apps/frontend/packages/api/src/ apps/frontend/packages/api/index.ts \
      || (echo "ERROR: generated contracts out of sync — run 'just sync'" && exit 1)

status:
    @git status -sb
    @echo "---"
    @gh pr status 2>/dev/null || echo "(gh not authed)"

# ─── Deploy ─────────────────────────────────────────────────
# Render K8s manifest for an environment. Pipe to `kubectl apply` after review.
# Usage: just k8s-render prod
k8s-render env="dev":
    @./scripts/k8s-render.sh {{ env }}

# Diff the rendered manifest against what's deployed on the prod cluster.
# Requires KUBECONFIG configured for the target cluster.
k8s-diff env="prod":
    @./scripts/k8s-render.sh {{ env }} | kubectl diff -f - || true

# Spin up a local kind cluster and validate the prod overlay against a real
# kube-apiserver. Dry-run only (no pods scheduled). For end-to-end:
#   just k8s-kind-up --apply --build
k8s-kind-up *flags:
    @./scripts/k8s-kind-up.sh {{ flags }}

# Tear down the local kind cluster.
k8s-kind-down:
    @./scripts/k8s-kind-down.sh

# Backwards-compat alias for the older `just k8s-kind` recipe name.
alias k8s-kind := k8s-kind-up

# ─── Scaffolding ────────────────────────────────────────────
new-service name:
    ./scripts/new-service.sh {{ name }}

new-mfe name:
    ./scripts/new-mfe.sh {{ name }}

worktree task subagent:
    ./scripts/worktree.sh {{ task }} {{ subagent }}

doctor:
    @./scripts/doctor.sh

# Build the policy-enforcing sandbox egress proxy.
build-sandbox-proxy registry="local" tag="latest":
    docker build -t {{registry}}/sandbox-proxy:{{tag}} -f apps/backend/services/sandbox/proxy/Dockerfile .

# Requires Docker and prebuilt runtime/proxy images; executes real isolated commands.
test-sandbox-integration:
    pnpm --dir apps/backend --filter sandbox run test:integration
