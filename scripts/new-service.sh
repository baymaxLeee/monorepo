#!/usr/bin/env bash
# Scaffold a new Python microservice under apps/backend/services/<name>.
set -euo pipefail

NAME="${1:?Usage: new-service.sh <name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC_DIR="$ROOT/apps/backend/services/$NAME"

if [ -d "$SVC_DIR" ]; then
  echo "✗ already exists: $SVC_DIR" >&2
  exit 1
fi

echo "→ Scaffolding service: $NAME at $SVC_DIR"
mkdir -p "$SVC_DIR"/{src/$NAME/{routes,models,repository},migrations/versions}

cat > "$SVC_DIR/pyproject.toml" <<EOF
[project]
name = "$NAME"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.7",
    "kernel",
    "auth_sdk",
    "audit_sdk",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/$NAME"]
EOF

cat > "$SVC_DIR/AGENTS.md" <<EOF
# $NAME service

(Document responsibilities, owns/does-not-own, entry points here.)
EOF

cat > "$SVC_DIR/src/$NAME/__init__.py" <<EOF
"""$NAME microservice."""

__version__ = "0.1.0"
EOF

cat > "$SVC_DIR/src/$NAME/main.py" <<EOF
from fastapi import FastAPI
from kernel.errors import register_exception_handlers
from .routes import health


def create_app() -> FastAPI:
    app = FastAPI(title="$NAME service", version="0.1.0")
    register_exception_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
EOF

cat > "$SVC_DIR/src/$NAME/gen_openapi.py" <<EOF
import json, sys
from .main import app
json.dump(app.openapi(), sys.stdout, indent=2, ensure_ascii=False)
EOF

cat > "$SVC_DIR/src/$NAME/routes/__init__.py" <<EOF
EOF

cat > "$SVC_DIR/src/$NAME/routes/health.py" <<EOF
from fastapi import APIRouter
router = APIRouter(tags=["meta"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
EOF

echo "✓ Created $SVC_DIR"
echo ""
echo "Next:"
echo "  1. Add '$NAME' to apps/backend/justfile PY_SERVICES list"
echo "  2. Add to apps/backend/pyproject.toml [tool.uv.workspace] members"
echo "  3. cd $SVC_DIR && uv sync"
echo "  4. Add k8s manifests: infra/k8s/base/$NAME/"
