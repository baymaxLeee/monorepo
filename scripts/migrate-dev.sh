#!/usr/bin/env bash
# Apply dev database schema (SQLAlchemy create_all + demo seed for admin).
# Run from `just up` after Postgres is healthy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_DIR="$ROOT/apps/backend/services/admin"

if [ ! -f "$ADMIN_DIR/.env" ]; then
  echo "⚠ $ADMIN_DIR/.env missing; copy from .env.example" >&2
  exit 1
fi

echo "→ Applying admin schema (create_all + seed)..."
cd "$ADMIN_DIR"
uv run python - <<'PY'
import asyncio

from admin.db import close_db, init_db, seed_demo_bots


async def main() -> None:
    await init_db()
    await seed_demo_bots()
    await close_db()


asyncio.run(main())
PY
echo "✓ admin database schema ready"
