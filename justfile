set positional-arguments
set shell := ["bash", "-cu"]

# Default: list commands
default:
    @just --list

# ─── Lifecycle ──────────────────────────────────────────────
# Start local dependencies (Postgres, Redis)
up:
    docker compose up -d
    @echo "✓ Postgres ready on :5432, Redis on :6379"

# Stop local dependencies
down:
    docker compose down

# Install all deps (frontend + backend)
install:
    @echo "→ Installing tool versions (mise)..."
    mise install || echo "(mise not installed; skipping. Install: https://mise.jdx.dev)"
    @echo "→ Frontend deps..."
    cd apps/frontend && pnpm install
    @echo "→ Backend Python deps..."
    cd apps/backend && uv sync --all-packages
    @echo "→ Backend Go deps..."
    cd apps/backend/services/api-gateway && go mod tidy
    @echo "✓ All deps installed"

# ─── Dev (the full demo) ────────────────────────────────────
# Start ALL services with one command. Auto-detects available process manager.
#
#   shell:    http://localhost:3000
#   mfe-bot:  http://localhost:3001
#   gateway:  http://localhost:8000
#   bot:      http://localhost:8001/docs
#
# Recommended: `brew install overmind` for the best DX (per-service log panes,
# `overmind connect <name>` to attach a single service, clean Ctrl+C).
dev:
    @if command -v overmind >/dev/null 2>&1; then \
        echo "→ Starting via overmind (Procfile.dev)"; \
        overmind start -f Procfile.dev; \
    elif command -v mprocs >/dev/null 2>&1; then \
        echo "→ Starting via mprocs"; \
        mprocs --config Procfile.dev; \
    elif command -v hivemind >/dev/null 2>&1; then \
        echo "→ Starting via hivemind"; \
        hivemind Procfile.dev; \
    else \
        echo "ℹ No process manager found. Falling back to backgrounded shell."; \
        echo "  For nicer DX: brew install overmind  (or mprocs / hivemind)"; \
        just dev-shell; \
    fi

# Pure-shell fallback: backgrounds 4 processes with prefixed output. Ctrl+C kills all.
# Honors the same dependency order as Procfile.dev: shell waits for mfe-bot manifest.
dev-shell:
    @echo "→ Starting full demo stack (shell mode). Ctrl+C to stop all."
    @bash -c ' \
        trap "kill 0" EXIT INT TERM; \
        ( cd apps/backend/services/bot && uv run uvicorn bot.main:app --reload --port 8001 2>&1 | sed "s/^/[bot]      /" ) & \
        ( cd apps/backend/services/api-gateway && PORT=8000 BOT_SERVICE_URL=http://localhost:8001 go run ./cmd/server 2>&1 | sed "s/^/[gateway]  /" ) & \
        ( cd apps/frontend/apps/mfe-bot && PORT=3001 pnpm dev 2>&1 | sed "s/^/[mfe-bot]  /" ) & \
        ( ./scripts/wait-for-url.sh http://localhost:3001/mf-manifest.json mfe-bot 2>&1 | sed "s/^/[wait]     /" \
            && cd apps/frontend/apps/shell && PORT=3000 pnpm dev 2>&1 | sed "s/^/[shell]    /" ) & \
        wait \
    '

# Print the URLs of running dev services
dev-urls:
    @echo "  shell:    http://localhost:3000"
    @echo "  mfe-bot:  http://localhost:3001"
    @echo "  gateway:  http://localhost:8000"
    @echo "  bot docs: http://localhost:8001/docs"

# ─── Build ──────────────────────────────────────────────────
# Build all release artifacts.
#
# Frontend → static bundles in apps/frontend/apps/<name>/dist + mf-manifest.json
# Backend  → Go binaries in apps/backend/services/<svc>/bin/server
# Python services don't need a build step (run from source); use `just build-images`
# if you want container artifacts.
#
#   just build                  # everything (frontend + Go binaries)
#   just build frontend         # only frontend
#   just build backend          # only backend Go binaries
#   just build shell            # single frontend app (delegates to frontend justfile)
#   just build api-gateway      # single backend Go service
build target="":
    @if [ -z "{{target}}" ]; then \
        just build-frontend && just build-backend; \
    elif [ "{{target}}" = "frontend" ]; then just build-frontend; \
    elif [ "{{target}}" = "backend" ]; then just build-backend; \
    elif [ -d "apps/frontend/apps/{{target}}" ]; then \
        cd apps/frontend && just build {{target}}; \
    elif [ -d "apps/backend/services/{{target}}" ]; then \
        cd apps/backend && just build {{target}}; \
    else echo "✗ Unknown build target: {{target}}"; exit 1; fi

build-frontend:
    @echo "→ Building frontend (turbo: packages → apps)..."
    cd apps/frontend && just build

build-backend:
    @echo "→ Building backend Go binaries..."
    cd apps/backend && just build-go

# Build docker images for backend services. Usage:
#   just build-images                       # local/<svc>:latest
#   just build-images my-registry.io v1.2.3 # my-registry.io/<svc>:v1.2.3
build-images registry="local" tag="latest":
    cd apps/backend && just build-images {{registry}} {{tag}}

# ─── Cross-stack ────────────────────────────────────────────
# Sync: backend exports OpenAPI → frontend regenerates TS client
sync:
    cd apps/backend && just gen-openapi bot
    cd apps/frontend && just gen-client
    @echo "✓ Schema synced. Try: just test"

# Format everything (auto-run after edits, no need to ask)
fmt:
    cd apps/backend && just fmt
    cd apps/frontend && just fmt

# Lint both stacks
lint:
    cd apps/backend && just lint
    cd apps/frontend && just lint

# Run tests for both stacks (scoped)
test:
    cd apps/backend && just test
    cd apps/frontend && just test

# Quick status overview
status:
    @git status -sb
    @echo "---"
    @gh pr status 2>/dev/null || echo "(gh not authed)"

# ─── Scaffolding ────────────────────────────────────────────
# Create a new microservice
new-service name:
    ./scripts/new-service.sh {{name}}

# Create a new micro-frontend
new-mfe name:
    ./scripts/new-mfe.sh {{name}}

# Spawn a git worktree for an isolated agent run (escape hatch)
worktree task subagent:
    ./scripts/worktree.sh {{task}} {{subagent}}

# ─── Health ─────────────────────────────────────────────────
doctor:
    @./scripts/doctor.sh
