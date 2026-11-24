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

test("local application reset preserves Admin and IAM while clearing every disposable data owner", () => {
  const reset = readFileSync(resolve(root, "scripts/reset-application-data.sh"), "utf8");
  const justfile = readFileSync(resolve(root, "justfile"), "utf8");

  assert.match(reset, /APPLICATION_DATABASES=\(canvas chat knowledge runtime storage telemetry\)/);
  assert.match(reset, /preserving PostgreSQL databases: admin, iam/);
  assert.doesNotMatch(reset, /APPLICATION_DATABASES=.*\b(?:admin|iam)\b/);
  assert.match(reset, /DROP DATABASE IF EXISTS "workflow" WITH \(FORCE\)/);
  assert.match(reset, /redis-cli FLUSHALL/);
  assert.match(reset, /DROP DATABASE IF EXISTS otel; CREATE DATABASE otel/);
  assert.match(justfile, /reset-application-data:\n\s+@\.\/scripts\/reset-application-data\.sh/);
});
