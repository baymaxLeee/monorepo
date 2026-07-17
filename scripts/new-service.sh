#!/usr/bin/env bash
set -euo pipefail

NAME="${1:?Usage: new-service.sh <name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC_DIR="$ROOT/apps/backend/services/$NAME"

if [ -d "$SVC_DIR" ]; then
  echo "✗ already exists: $SVC_DIR" >&2
  exit 1
fi

echo "→ Scaffolding service: $NAME at $SVC_DIR"
mkdir -p "$SVC_DIR"/{src/{bootstrap,api/http/routes,application/contracts,infrastructure/persistence/{models,repositories}},migrations/versions}
touch \
  "$SVC_DIR/src/bootstrap/__init__.py" \
  "$SVC_DIR/src/api/__init__.py" \
  "$SVC_DIR/src/api/http/__init__.py" \
  "$SVC_DIR/src/api/http/routes/__init__.py" \
  "$SVC_DIR/src/application/__init__.py" \
  "$SVC_DIR/src/application/contracts/__init__.py" \
  "$SVC_DIR/src/infrastructure/__init__.py" \
  "$SVC_DIR/src/infrastructure/persistence/__init__.py" \
  "$SVC_DIR/src/infrastructure/persistence/models/__init__.py" \
  "$SVC_DIR/src/infrastructure/persistence/repositories/__init__.py"

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

[tool.uv]
package = false

[tool.mypy]
mypy_path = "src"
explicit_package_bases = true
files = ["src"]
EOF

cat > "$SVC_DIR/AGENTS.md" <<EOF
# $NAME service

(Document responsibilities, owns/does-not-own, entry points here.)
EOF

cat > "$SVC_DIR/src/main.py" <<EOF
from fastapi import FastAPI
from api.http.routes import health
from kernel.errors import register_exception_handlers


def create_app() -> FastAPI:
    app = FastAPI(title="$NAME service", version="0.1.0")
    register_exception_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
EOF

cat > "$SVC_DIR/src/gen_openapi.py" <<EOF
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import app

json.dump(app.openapi(), sys.stdout, indent=2, ensure_ascii=False)
sys.stdout.write("\n")
EOF

cat > "$SVC_DIR/src/api/http/routes/health.py" <<EOF
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
echo "  3. cd $ROOT/apps/backend && uv sync --all-packages"
echo "  4. Add k8s manifests: infra/k8s/base/$NAME/"
