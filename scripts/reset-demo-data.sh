#!/usr/bin/env bash
# Reset local demo-owned data and remove the legacy identity database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESET_DEMO_DATA=true "$ROOT/scripts/db-bootstrap.sh"
