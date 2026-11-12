import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { imagePlan, images } from "./image-plan.mjs";

const all = images.map(({ service }) => service);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("covers every locally published image consumed by Single-VPS", () => {
  const compose = readFileSync(resolve(root, "infra/single-vps/docker-compose.prod.yml"), "utf8");
  const deployed = [...compose.matchAll(/\$\{IMAGE_REGISTRY[^}]*\}\/([a-z0-9-]+):/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(deployed)].sort(), [...all].sort());
});

test("Python images use the same pinned uv version as local and hosted checks", () => {
  const mise = readFileSync(resolve(root, "mise.toml"), "utf8");
  const uvVersion = mise.match(/^uv = "([^"]+)"$/m)?.[1];
  assert.ok(uvVersion);
  for (const service of ["admin", "knowledge", "telemetry"]) {
    const dockerfile = readFileSync(resolve(root, `apps/backend/services/${service}/Dockerfile`), "utf8");
    assert.match(
      dockerfile,
      new RegExp(`^COPY --from=ghcr\\.io/astral-sh/uv:${uvVersion.replaceAll(".", "\\.")} /uv /uvx /bin/$`, "m"),
    );
  }
});

test("plans from the last successful release and forwards exact metadata through deployment", () => {
  const build = readFileSync(resolve(root, ".github/workflows/build-images.yml"), "utf8");
  const mirror = readFileSync(resolve(root, ".github/workflows/mirror-images.yml"), "utf8");
  const deploy = readFileSync(resolve(root, ".github/workflows/deploy-single-vps.yml"), "utf8");
  assert.match(build, /gh run list[^\n]+--status success/);
  const releasePlanStep = build.slice(
    build.indexOf("- name: Select affected images"),
    build.indexOf("- name: Save release plan"),
  );
  assert.doesNotMatch(releasePlanStep, /github\.event\.before/);
  assert.match(build, /name: image-plan/);
  assert.match(build, /\(\.build \+ \.reuse\)\[\]/);
  assert.doesNotMatch(build, /for service in gateway/);
  assert.match(mirror, /workflows: \["build-images"\]/);
  assert.match(mirror, /Forward release plan to deployment/);
  assert.match(deploy, /workflows: \["mirror-images"\]/);
  assert.match(deploy, /\.headSha/);
  assert.match(deploy, /\.imageTag/);
});

test("builds only the directly changed backend service", () => {
  const plan = imagePlan(["apps/backend/services/knowledge/src/main.py"]);
  assert.deepEqual(plan.build, ["knowledge"]);
  assert.ok(plan.reuse.includes("telemetry"));
  assert.deepEqual(plan.buildMatrix.include, [
    { service: "knowledge", context: "apps/backend", dockerfile: "apps/backend/services/knowledge/Dockerfile" },
  ]);
});

test("expands shared libraries only to image consumers", () => {
  assert.deepEqual(imagePlan(["apps/backend/libs/transport-ts/src/storage.ts"]).build, ["chat", "executor", "sandbox"]);
  assert.deepEqual(imagePlan(["apps/backend/libs/kernel/src/kernel/logging.py"]).build, [
    "admin",
    "knowledge",
    "telemetry",
  ]);
  assert.deepEqual(imagePlan(["apps/backend/libs/kernel-ts/src/index.ts"]).build, ["chat", "executor", "sandbox"]);
});

test("builds the web image for any frontend workspace change", () => {
  assert.deepEqual(imagePlan(["apps/frontend/packages/editors/src/index.ts"]).build, ["web"]);
});

test("migration changes build both their service and aggregate migrator", () => {
  assert.deepEqual(imagePlan(["apps/backend/services/storage/migrations/v1.0.1/v1.0.1.0.up.sql"]).build, [
    "storage",
    "db-init",
  ]);
});

test("deployment-only changes reuse every immutable image", () => {
  const plan = imagePlan(["infra/single-vps/docker-compose.prod.yml"]);
  assert.deepEqual(plan.build, []);
  assert.deepEqual(plan.reuse, all);
  assert.deepEqual(plan.buildMatrix, { include: [] });
});

test("image pipeline changes and unreliable diffs conservatively rebuild all", () => {
  assert.deepEqual(imagePlan([".github/workflows/build-images.yml"]).build, all);
  assert.deepEqual(imagePlan(null).build, all);
  assert.equal(imagePlan(["unknown-runtime-file"]).conservative, true);
});

test("context and unrelated workflow changes reuse existing images", () => {
  assert.deepEqual(imagePlan(["apps/backend/.dockerignore"]).build, ["admin", "knowledge", "telemetry"]);
  assert.deepEqual(imagePlan([".github/workflows/mirror-images.yml"]).build, []);
  assert.deepEqual(imagePlan([".github/workflows/storage.yml"]).build, []);
});

test("ordinary documentation does not invalidate runtime images", () => {
  const plan = imagePlan(["docs/ADR/container-image-delivery.md", "README.md", "apps/frontend/README.md"]);
  assert.deepEqual(plan.build, []);
  assert.deepEqual(plan.reuse, all);
  assert.deepEqual(imagePlan(["apps/backend/services/chat/src/prompts/system.md"]).build, ["chat"]);
});

test("quality and agent configuration reuse every immutable image", () => {
  for (const file of [
    ".github/workflows/tooling.yml",
    "oxlint.config.ts",
    "oxfmt.config.ts",
    ".pre-commit-config.yaml",
    "AGENTS.md",
    "apps/frontend/AGENTS.md",
    ".agents/skills/plan/SKILL.md",
    ".cursor/mcp.json",
  ]) {
    const plan = imagePlan([file]);
    assert.deepEqual(plan.build, [], file);
    assert.deepEqual(plan.reuse, all, file);
    assert.equal(plan.conservative, false, file);
  }
});

test("quality metadata does not widen a runtime change", () => {
  const plan = imagePlan([
    "apps/frontend/apps/chat/src/App.tsx",
    "oxlint.config.ts",
    "AGENTS.md",
    ".github/workflows/tooling.yml",
  ]);
  assert.deepEqual(plan.build, ["web"]);
  assert.equal(plan.conservative, false);
});
