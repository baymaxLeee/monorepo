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
# Prereq: `just up` first. URLs: platform :3000, mfe-admin :3001, gateway :8000, svc-admin :8001
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
    @echo "  gateway:   http://localhost:8000"
    @echo "  iam:      http://localhost:8002/healthz"
    @echo "  svc-admin: http://localhost:8001/docs"

# ─── Build ──────────────────────────────────────────────────
# Usage: build [target]  target = frontend | backend | platform | admin | api-gateway | ...
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
    cd apps/backend && just gen-openapi admin
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

# ─── Scaffolding ────────────────────────────────────────────
new-service name:
    ./scripts/new-service.sh {{ name }}

new-mfe name:
    ./scripts/new-mfe.sh {{ name }}

worktree task subagent:
    ./scripts/worktree.sh {{ task }} {{ subagent }}

doctor:
    @./scripts/doctor.sh
