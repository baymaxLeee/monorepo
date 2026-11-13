import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { codePlan, localImagePlatform, plan, push, releasePlan, verify } from "./local-ci.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "local-ci-"));
  const root = join(dir, "repo");
  const remote = join(dir, "remote.git");
  const bin = join(dir, "bin");
  mkdirSync(root);
  mkdirSync(bin);
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "core.hooksPath", "/dev/null");
  mkdirSync(join(root, "apps"));
  writeFileSync(join(root, "apps/example.ts"), "before\n");
  git("add", ".");
  git("commit", "-m", "initial");
  const base = git("rev-parse", "HEAD");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  git("push", "origin", "main");
  git("checkout", "-b", "feature");
  writeFileSync(join(root, "apps/example.ts"), "after\n");
  git("add", ".");
  git("commit", "-m", "change");
  writeFileSync(
    join(bin, "just"),
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === 'ci-code' && fs.existsSync('.git/move')) require('node:child_process').execFileSync('git', ['push', 'origin', 'HEAD~1:refs/heads/feature']);
if (process.argv[2] === 'ci-code' && fs.existsSync('.git/signal')) process.kill(process.pid, 'SIGTERM');
if (process.argv[2] === 'ci-code' && fs.existsSync('.git/fail')) process.exit(7);
if (process.argv[2] === 'ci-code' && fs.existsSync('.git/mutate')) fs.appendFileSync('apps/example.ts', 'mutation');
`,
    { mode: 0o755 },
  );
  for (const command of ["pnpm", "uv", "docker", "buf"])
    writeFileSync(join(bin, command), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  t.after(() => {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });
  return { root, git, base, report: () => JSON.parse(readFileSync(join(root, ".git/agent-ci/result.json"), "utf8")) };
}
test("failed checks block push and preserve actionable evidence", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".git/fail"), "");
  await assert.rejects(push(f.root, "origin", "feature"), /code failed/);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/feature"), "");
  assert.equal(f.report().status, "failed");
  assert.equal(f.report().steps.at(-1).code, 7);
  assert.ok(!f.report().steps.some((s) => s.name === "build"));
});
test("successful gate pushes only the verified commit", async (t) => {
  const f = fixture(t);
  await push(f.root, "origin", "feature");
  assert.equal(f.git("ls-remote", "origin", "refs/heads/feature").split(/\s/)[0], f.git("rev-parse", "HEAD"));
  assert.equal(f.report().status, "passed");
});
test("dirty work and wrong destinations are rejected", async (t) => {
  const f = fixture(t);
  await assert.rejects(push(f.root, "origin", "main"), /destination/);
  writeFileSync(join(f.root, "untracked.txt"), "uncommitted");
  await assert.rejects(push(f.root, "origin", "feature"), /clean working tree/);
});
test("check-induced changes invalidate verification and release the lock", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".git/mutate"), "");
  await assert.rejects(verify(f.root, f.base), /Files changed/);
  assert.equal(f.report().status, "failed");
  rmSync(join(f.root, ".git/mutate"));
  await verify(f.root, f.base);
  assert.equal(f.report().status, "passed");
});
test("invalid bases fail closed instead of selecting no tests", async (t) => {
  const f = fixture(t);
  await assert.rejects(verify(f.root, "missing-base"));
});
test("tooling changes run tooling checks without application tests or builds", () => {
  const steps = codePlan("base-sha", ["scripts/test.mjs", "scripts/README.md"]);
  const frontendDependencies = steps.findIndex((step) => step[0] === "frontend-dependencies");
  const toolingTests = steps.findIndex((step) => step[0] === "tooling-tests");
  assert.ok(frontendDependencies >= 0);
  assert.ok(toolingTests > frontendDependencies);
  assert.ok(!steps.some((step) => step[0] === "all-tests" || step[0] === "build"));
});
test("an explicit all base produces a complete gate without a fake breaking-change comparison", () => {
  const steps = codePlan("head-sha", null);
  assert.ok(steps.some((step) => step[0] === "all-tests"));
  assert.ok(steps.some((step) => step[0] === "migration-integration"));
  assert.ok(steps.some((step) => step[0] === "protobuf-lint"));
  assert.ok(!steps.some((step) => step[0] === "protobuf-breaking"));
});
test("ordinary project changes scope lint, format, types, tests and builds to owners and consumers", () => {
  const steps = codePlan("base-sha", ["apps/frontend/packages/ai-elements/src/Conversation/index.ts"]);
  assert.ok(steps.some((step) => step[0] === "frontend-lint"));
  assert.ok(steps.some((step) => step[0] === "frontend-format"));
  assert.deepEqual(steps.find((step) => step[0] === "frontend-format").slice(-1), [
    "apps/frontend/packages/ai-elements/src/Conversation/index.ts",
  ]);
  assert.ok(steps.some((step) => step[0] === "frontend-types"));
  const uiContracts = steps.find((step) => step[0] === "frontend-ui-contracts");
  assert.ok(uiContracts.includes("apps/frontend/packages/ai-elements"));
  assert.ok(!uiContracts.includes("apps/frontend/packages/ai-elements/src/Conversation/index.ts"));
  assert.ok(steps.find((step) => step[0] === "frontend-boundaries").includes("@repo/ai-elements"));
  assert.ok(steps.find((step) => step[0] === "frontend-tests").includes("@repo/ai-elements"));
  assert.ok(steps.some((step) => step[0] === "build-frontend/chat"));
  assert.ok(!steps.some((step) => step[0] === "lint-format-types" || step[0] === "build"));
  assert.deepEqual(steps.find((step) => step[0] === "build-frontend/chat").slice(1), [
    "just",
    "--justfile",
    "apps/frontend/justfile",
    "--working-directory",
    "apps/frontend",
    "build",
    "chat",
  ]);
});
test("end-to-end chat changes stay inside chat owners and declared consumers", () => {
  const steps = codePlan("base-sha", [
    "apps/frontend/apps/chat/src/App.tsx",
    "apps/frontend/packages/ai-elements/src/Conversation/index.ts",
    "apps/backend/services/chat/src/main.ts",
  ]);
  const serialized = JSON.stringify(steps);
  assert.match(serialized, /frontend\/chat/);
  assert.match(serialized, /apps\/frontend\/packages\/ai-elements|@repo\/ai-elements/);
  assert.match(serialized, /backend\/chat/);
  assert.doesNotMatch(serialized, /frontend\/platform|frontend\/admin|backend\/admin|backend\/knowledge/);
  assert.ok(!steps.some((step) => step[0] === "all-tests" || step[0] === "build"));
});
test("chat app and service changes do not pull in unrelated consumers", () => {
  const steps = codePlan("base-sha", ["apps/frontend/apps/chat/src/App.tsx", "apps/backend/services/chat/src/main.ts"]);
  const serialized = JSON.stringify(steps);
  assert.match(serialized, /frontend\/chat/);
  assert.match(serialized, /backend\/chat/);
  assert.doesNotMatch(serialized, /frontend\/canvas/);
});
test("the chat stream contract selects chat producers and consumers instead of the whole repository", () => {
  const steps = codePlan("base-sha", ["schemas/streaming/chat-ui.ts"]);
  assert.ok(steps.some((step) => step[0] === "contracts"));
  assert.ok(steps.some((step) => step[0] === "test-backend/chat"));
  assert.ok(steps.some((step) => step[0] === "frontend-tests"));
  assert.ok(!steps.some((step) => step[0] === "all-tests" || step[0] === "build"));
});
test("area-level configuration changes widen only to their owning stack", () => {
  const steps = codePlan("base-sha", ["apps/frontend/vitest.config.mts"]);
  assert.ok(steps.some((step) => step[0] === "build-frontend/chat"));
  assert.ok(!steps.some((step) => step[0].startsWith("build-backend/")));
  assert.ok(!steps.some((step) => step[0] === "all-tests"));
});
test("a project manifest stays within its owner and declared consumers", () => {
  const steps = codePlan("base-sha", ["apps/frontend/packages/ai-elements/package.json"]);
  const serialized = JSON.stringify(steps);
  assert.match(serialized, /frontend\/chat/);
  assert.match(serialized, /frontend\/canvas/);
  assert.doesNotMatch(serialized, /frontend\/platform|frontend\/admin/);
});
test("the push gate remains fast while the optional release gate retains production-platform images", () => {
  assert.deepEqual(plan("base-sha"), [["code", "just", "ci-code", "base-sha"]]);
  const steps = releasePlan("base-sha", ["scripts/test.mjs", "apps/frontend/apps/chat/src/example.ts"], "linux/amd64");
  assert.deepEqual(steps[0], ["code", "just", "ci-code", "base-sha"]);
  const image = steps.find((s) => s[0] === "image-web");
  assert.ok(image.includes("linux/amd64"));
  assert.ok(!image.includes("--push"));
});
test("local image checks avoid cross-architecture emulation on Apple Silicon", () => {
  assert.equal(localImagePlatform("arm64"), "linux/arm64");
  assert.equal(localImagePlatform("x64"), "linux/amd64");
});
test("the release workflow invokes the canonical code gate on the pinned runner", () => {
  const workflow = readFileSync(join(import.meta.dirname, "../.github/workflows/build-images.yml"), "utf8");
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /run: just ci-code "\$\{TEST_BASE\}"/);
  assert.doesNotMatch(workflow, /uses: \.\/\.github\/workflows\/(?:backend|frontend|tooling|contracts)\.yml/);
});

test("remote movement during checks prevents the verified commit from being pushed", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".git/move"), "");
  await assert.rejects(push(f.root, "origin", "feature"), /Remote moved/);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/feature").split(/\s/)[0], f.base);
});
test("concurrent verification cannot overwrite the active result", async (t) => {
  const f = fixture(t);
  const running = verify(f.root, f.base);
  await assert.rejects(verify(f.root, f.base), /EEXIST/);
  await running;
  assert.equal(f.report().status, "passed");
});
test("documentation plans avoid application builds but retain tooling verification", () => {
  const steps = codePlan("base", ["AGENTS.md", "scripts/README.md"]);
  assert.ok(steps.some((step) => step[0] === "tooling-tests"));
  assert.ok(!steps.some((step) => step[0] === "build"));
});

test("a terminated check blocks push and releases the verification lock", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".git/signal"), "");
  await assert.rejects(push(f.root, "origin", "feature"), /code failed/);
  assert.equal(f.report().steps.at(-1).signal, "SIGTERM");
  assert.equal(f.git("ls-remote", "origin", "refs/heads/feature"), "");
  rmSync(join(f.root, ".git/signal"));
  await verify(f.root, f.base);
  assert.equal(f.report().status, "passed");
});
