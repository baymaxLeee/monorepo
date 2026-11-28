import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  assert.fail(message);
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

test("Ctrl-C asks an app-owned Overmind server to quit", async () => {
  await withCommands(
    {
      just: `
touch "$APP_TEST_DIR/.overmind.sock"
exec ${JSON.stringify(process.execPath)} -e '
  const server = require("node:http").createServer((_, response) => response.end("ok"));
  server.listen(3000, "127.0.0.1");
  process.on("SIGTERM", () => process.exit(0));
'
`,
      overmind: 'printf "%s\\n" "$@" > "$APP_TEST_DIR/overmind-args"',
      pnpm: 'touch "$APP_TEST_DIR/electron-started"; trap "exit 0" TERM INT; while :; do sleep 1; done',
    },
    async (directory, env) => {
      const child = spawn(process.execPath, [app], { cwd: directory, env, stdio: "ignore" });
      await waitUntil(() => existsSync(path.join(directory, "electron-started")), "Electron did not start");
      child.kill("SIGINT");
      const result = await new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });

      assert.equal(result.signal, null);
      assert.equal(result.code, 130);
      assert.deepEqual(readFileSync(path.join(directory, "overmind-args"), "utf8").trim().split("\n"), [
        "quit",
        "-s",
        path.join(realpathSync(directory), ".overmind.sock"),
      ]);
    },
  );
});
