import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Admin owns one app-registry seed used by local and Single-VPS bootstrap", () => {
  const seedPath = resolve(root, "apps/backend/services/admin/seed/apps.sql");
  const seed = readFileSync(seedPath, "utf8");
  const localBootstrap = readFileSync(resolve(root, "scripts/db-bootstrap.sh"), "utf8");
  const image = readFileSync(resolve(root, "infra/single-vps/Dockerfile.db-init"), "utf8");

  for (const app of ["admin", "chat", "canvas"]) {
    assert.match(seed, new RegExp(`\\('${app}',`));
    assert.match(seed, new RegExp(`/mfe-${app}/mf-manifest\\.json`));
  }
  assert.match(seed, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(localBootstrap, /ADMIN_SEED="\$SERVICES_DIR\/admin\/seed\/apps\.sql"/);
  assert.match(image, /COPY apps\/backend\/services\/admin\/seed\/apps\.sql \/seed\/admin\/apps\.sql/);
});
