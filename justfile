set positional-arguments
set shell := ["bash", "-cu"]

# Default: list commands
default:
    @just --list

# ─── Lifecycle ──────────────────────────────────────────────
# Start local infra: Docker, create DBs, apply service-owned dev schemas.
up:
    docker compose up -d
    @./scripts/wait-for-mysql.sh
    @./scripts/db-bootstrap.sh
    @echo "OK Infra up - MySQL :3306, Redis :6379"

reset-demo-data:
    @./scripts/reset-demo-data.sh

down:
    docker compose down

# Install all deps (mise, pnpm, uv, go). Does not start Docker.
install:
    @./scripts/install-deps.sh

# ─── Dev ────────────────────────────────────────────────────
# Prereq: `just up` first. URLs: platform :3000, mfe-admin :3001, gateway :8000, svc-admin :8001, telemetry :8008
dev:
    @just dev-preflight
    @./scripts/dev-orchestrator.sh

dev-preflight:
    @./scripts/dev-preflight.sh

dev-shell:
    @just dev-preflight
    @./scripts/dev-stack.sh

dev-urls:
    @echo "  platform:  http://localhost:3000"
    @echo "  mfe-admin: http://localhost:3001"
    @echo "  mfe-chat:  http://localhost:3005"
    @echo "  gateway:   http://localhost:8000"
    @echo "  telemetry: http://localhost:8008/healthz"
    @echo "  iam:      http://localhost:8002/healthz"
    @echo "  svc-admin: http://localhost:8001/docs"
    @echo "  svc-chat:  http://localhost:8009/docs"

# ─── Build ──────────────────────────────────────────────────
# Usage: build [target]  target = frontend | backend | platform | admin | gateway | ...
build target="":
    @./scripts/build-target.sh "{{ target }}"

build-frontend:
    @echo "Building frontend..."
    cd apps/frontend && just build

build-backend:
    @echo "Building backend Go binaries..."
    cd apps/backend && just build-go

build-images registry="local" tag="latest":
    cd apps/backend && just build-images {{ registry }} {{ tag }}

# ─── Cross-stack ────────────────────────────────────────────
sync:
    cd apps/backend && just gen-openapi-all
    cd apps/frontend && just gen-client
    @echo "OK Schema synced"

fmt:
    cd apps/backend && just fmt
    cd apps/frontend && just fmt

lint:
    cd apps/backend && just lint
    cd apps/frontend && just lint

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
