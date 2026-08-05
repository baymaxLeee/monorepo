#!/usr/bin/env bash
set -euo pipefail

NAME="${1:?Usage: new-service.sh <name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVC_DIR="$ROOT/apps/backend/services/$NAME"

if [[ ! "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "✗ name must be a lowercase service slug" >&2
  exit 1
fi

if [ -d "$SVC_DIR" ]; then
  echo "✗ already exists: $SVC_DIR" >&2
  exit 1
fi

echo "→ Scaffolding unregistered Python service: $NAME"
mkdir -p "$SVC_DIR"/src/{bootstrap,api/http/routes,application/contracts,infrastructure}
touch \
  "$SVC_DIR/src/bootstrap/__init__.py" \
  "$SVC_DIR/src/api/__init__.py" \
  "$SVC_DIR/src/api/http/__init__.py" \
  "$SVC_DIR/src/api/http/routes/__init__.py" \
  "$SVC_DIR/src/application/__init__.py" \
  "$SVC_DIR/src/application/contracts/__init__.py" \
  "$SVC_DIR/src/infrastructure/__init__.py"

cat > "$SVC_DIR/pyproject.toml" <<EOF
[project]
name = "$NAME"
version = "0.1.0"
requires-python = ">=3.14.5,<3.15"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.7",
    "kernel",
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

Document the service responsibility, owned data, public/internal status,
outbound bindings, and resource-specific module boundaries before adding
business behavior. Follow the parent backend rules and ADR-0060/0061.
EOF

cat > "$SVC_DIR/src/main.py" <<EOF
from api.http.routes import health
from fastapi import FastAPI
from kernel.errors import register_exception_handlers


def create_app() -> FastAPI:
    app = FastAPI(title="$NAME service", version="0.1.0")
    register_exception_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
EOF

cat > "$SVC_DIR/src/gen_openapi.py" <<'EOF'
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import app

json.dump(app.openapi(), sys.stdout, indent=2, ensure_ascii=False)
sys.stdout.write("\n")
EOF

cat > "$SVC_DIR/src/api/http/routes/health.py" <<'EOF'
from fastapi import APIRouter

router = APIRouter(tags=["meta"])


@router.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
EOF

echo "✓ Created $SVC_DIR"
echo
echo "The scaffold is intentionally not registered: port, publicity, bindings, and data ownership are architecture decisions."
echo "Next: follow .agents/playbooks/new-microservice.md and update services.yaml first."
echo "Root just lint will reject the unregistered directory until composition is complete."
