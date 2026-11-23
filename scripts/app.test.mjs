import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("./app.mjs", import.meta.url));

async function withCommands(commands, run) {
  const directory = mkdtempSync(path.join(tmpdir(), "monorepo-app-test-"));
  try {
    for (const [name, body] of Object.entries(commands)) {
      const file = path.join(directory, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
    }
    return await run(directory, { ...process.env, PATH: `${directory}:${process.env.PATH}`, APP_TEST_DIR: directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("VPS mode passes the selected root URL to Electron without starting local dev", async () => {
  await withCommands({ just: "exit 99", pnpm: 'printf "%s\\n" "$@" > "$APP_TEST_DIR/args"' }, (directory, env) => {
    const result = spawnSync(process.execPath, [app, "vps"], {
      env: { ...env, DESKTOP_PLATFORM_URL: "http://vps.test:8080/" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(path.join(directory, "args"), "utf8").trim().split("\n"), [
      "--dir",
      "apps/frontend/apps/desktop",
      "launch",
      "--platform-url=http://vps.test:8080/",
      "--allow-http",
    ]);
  });
});

test("a failed local dev stack prevents Electron from launching", async () => {
  await withCommands({ just: "exit 17", pnpm: 'touch "$APP_TEST_DIR/electron-started"' }, (directory, env) => {
    const result = spawnSync(process.execPath, [app], { env, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /just dev exited with status 17/);
    assert.throws(() => readFileSync(path.join(directory, "electron-started")));
  });
});
