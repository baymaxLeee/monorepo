import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("registry login retries transient failures without exposing the password", (t) => {
  const root = mkdtempSync(join(tmpdir(), "registry-login-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const attempts = join(root, "attempts");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
password="$(cat)"
count=0
[ ! -f "$ATTEMPTS_FILE" ] || count="$(cat "$ATTEMPTS_FILE")"
count=$((count + 1))
printf '%s' "$count" > "$ATTEMPTS_FILE"
[ "$1" = login ] && [ "$2" = registry.example.com ] && [ "$3" = --username ] && [ "$4" = robot ] && [ "$5" = --password-stdin ] || exit 9
[ "$password" = super-secret ] || exit 8
[ "$count" -ge 3 ]
`,
    { mode: 0o755 },
  );

  const result = spawnSync("bash", [resolve("scripts/registry-login.sh"), "registry.example.com", "robot"], {
    input: "super-secret\n",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ATTEMPTS_FILE: attempts,
      REGISTRY_LOGIN_ATTEMPTS: "4",
      REGISTRY_LOGIN_INITIAL_DELAY_SECONDS: "0",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(attempts, "utf8"), "3");
  assert.doesNotMatch(result.stdout + result.stderr, /super-secret/);
});

test("registry login stops after the configured attempt limit", (t) => {
  const root = mkdtempSync(join(tmpdir(), "registry-login-limit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const attempts = join(root, "attempts");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
cat >/dev/null
count=0
[ ! -f "$ATTEMPTS_FILE" ] || count="$(cat "$ATTEMPTS_FILE")"
printf '%s' "$((count + 1))" > "$ATTEMPTS_FILE"
exit 1
`,
    { mode: 0o755 },
  );

  const result = spawnSync("bash", [resolve("scripts/registry-login.sh"), "registry.example.com", "robot"], {
    input: "super-secret\n",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ATTEMPTS_FILE: attempts,
      REGISTRY_LOGIN_ATTEMPTS: "3",
      REGISTRY_LOGIN_INITIAL_DELAY_SECONDS: "0",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.equal(readFileSync(attempts, "utf8"), "3");
  assert.match(result.stderr, /failed after 3 attempts/);
});

test("mirror workflow uses the retrying login for built and reused images", () => {
  const workflow = readFileSync(resolve(".github/workflows/mirror-images.yml"), "utf8");
  assert.equal(workflow.match(/bash scripts\/registry-login\.sh/g)?.length, 2);
  assert.equal(workflow.match(/sparse-checkout: scripts\/registry-login\.sh/g)?.length, 2);
});

test("mirror workflow uses provider-neutral repository configuration names", () => {
  const workflow = readFileSync(resolve(".github/workflows/mirror-images.yml"), "utf8");
  assert.equal(workflow.match(/vars\.MIRROR_HOST/g)?.length, 4);
  assert.equal(workflow.match(/vars\.MIRROR_NAMESPACE/g)?.length, 3);
  assert.equal(workflow.match(/secrets\.MIRROR_USERNAME/g)?.length, 2);
  assert.equal(workflow.match(/secrets\.MIRROR_PASSWORD/g)?.length, 2);
  assert.doesNotMatch(workflow, /vars\.TCR_(?:HOST|NAMESPACE)/);
  assert.doesNotMatch(workflow, /secrets\.TCR_(?:USERNAME|PASSWORD)/);
});
