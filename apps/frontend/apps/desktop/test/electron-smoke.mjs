import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { app, BrowserWindow, dialog } from "electron";

async function run() {
  app.setActivationPolicy("prohibited");
  app.on("browser-window-created", (_event, window) => {
    // Exercise the real renderer and file input without showing a test window.
    window.show = () => {};
  });
  const directory = await mkdtemp(join(tmpdir(), "electron-local-e2e-"));
  const workspace = join(directory, "project");
  await mkdir(workspace);
  await writeFile(
    join(workspace, "nested-node.cjs"),
    `const assert = require("node:assert/strict");
assert.equal(process.versions.electron, undefined, "workspace node must be standalone");
require("node:child_process").execFileSync(process.execPath, ["-e", "process.stdout.write('agent content')"], {
  env: {}, stdio: "inherit"
});`,
  );
  const plugin = join(directory, "plugin");
  await mkdir(join(plugin, ".codex-plugin"), { recursive: true });
  await mkdir(join(plugin, "skills", "style"), { recursive: true });
  await writeFile(join(plugin, ".codex-plugin/plugin.json"), JSON.stringify({ name: "style" }));
  await writeFile(
    join(plugin, "skills/style/SKILL.md"),
    "---\nname: style\ndescription: Style guide\n---\nUse short sentences.",
  );
  let calls = 0;
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Desktop smoke fixture</title><h1>Local execution integration</h1>");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/iam-server/test-login") {
      response.setHeader("Set-Cookie", "refresh_token=fixture-refresh; HttpOnly; Path=/; SameSite=Lax");
      response.end("{}");
      return;
    }
    if (request.url === "/api/iam-server/refresh") {
      assert.match(request.headers.cookie ?? "", /refresh_token=fixture-refresh/);
      response.end(
        JSON.stringify({
          accessToken: "fixture-token",
          expiresAt: "2099-01-01T00:00:00Z",
          user: { id: "smoke-user", activeWorkspace: { tenantId: "test", workspaceId: "workspace", status: "active" } },
        }),
      );
      return;
    }
    if (request.url === "/api/iam-server/me") {
      response.end(
        JSON.stringify({
          id: "smoke-user",
          activeWorkspace: { tenantId: "test", workspaceId: "workspace", status: "active" },
        }),
      );
      return;
    }
    if (request.url === "/api/chat-server/local-inference/config?provider_id=provider&reasoning_effort=medium") {
      response.end(
        JSON.stringify({
          providerId: "provider",
          providerName: "test",
          reasoningEffort: "medium",
          model: "fixture",
          instructions: "",
          contextWindow: 100000,
          maxOutputTokens: 4096,
        }),
      );
      return;
    }
    if (request.url === "/api/chat-server/local-inference/plugins/resolve") {
      assert.equal(request.method, "POST");
      assert.equal(request.headers.authorization, "Bearer fixture-token");
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        assert.deepEqual(JSON.parse(body), { activations: [] });
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            snapshotId: "empty",
            snapshotDigest: `sha256:${"0".repeat(64)}`,
            workspaceRevision: 1,
            tenantId: "test",
            workspaceId: "workspace",
            resolvedAt: "2026-01-01T00:00:00.000Z",
            plugins: [],
            connectionGrants: [],
          }),
        );
      });
      return;
    }
    if (request.url === "/api/chat-server/local-inference/stream") {
      assert.equal(request.headers.authorization, "Bearer fixture-token");
      request.resume();
      const parts = [
        { type: "stream-start", warnings: [] },
        ...(calls++ === 0
          ? [
              {
                type: "tool-call",
                toolCallId: "write",
                toolName: "bash",
                input: JSON.stringify({ command: "node nested-node.cjs > demo.js" }),
              },
            ]
          : [
              { type: "text-start", id: "text" },
              { type: "text-delta", id: "text", delta: "done" },
              { type: "text-end", id: "text" },
            ]),
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
        },
      ];
      response.setHeader("Content-Type", "application/x-ndjson");
      response.end(parts.map((part) => JSON.stringify(part)).join("\n") + "\n");
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  process.env.MONOREPO_AGENT_HOME = join(directory, "agent-home");
  process.argv.push(`--platform-url=http://127.0.0.1:${port}`, `--user-data=${join(directory, "state")}`);
  dialog.showOpenDialog = async (_window, options) => ({
    canceled: false,
    filePaths: [options?.title === "导入本地插件" ? plugin : workspace],
  });
  dialog.showMessageBox = async (_window, options) => {
    const message = options ?? _window;
    if (message.type === "error") throw new Error(message.detail ?? message.message);
    return { response: 1, checkboxChecked: false };
  };
  const require = createRequire(import.meta.url);
  require(resolve(import.meta.dirname, "../dist/main.cjs"));
  try {
    await app.whenReady();
    let window;
    for (let i = 0; i < 100; i++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoading() && window.webContents.getURL()) break;
      await delay(50);
    }
    assert.ok(window);
    const execute = (code) => window.webContents.executeJavaScript(code);
    for (let i = 0; i < 100; i++) {
      if (await execute("Boolean(globalThis.desktop)")) break;
      await delay(50);
    }
    assert.equal((await execute("desktop.info()")).localAvailable, true);
    assert.equal(await execute("typeof require"), "undefined");
    await execute('desktop.bindSession("fixture-token", "2099-01-01T00:00:00Z")');
    await execute('fetch("/api/iam-server/test-login", { method: "POST", credentials: "include" })');
    assert.equal((await execute("desktop.refreshSession()")).accessToken, "fixture-token");
    await assert.rejects(
      execute(
        `desktop.createThread(${JSON.stringify(workspace)}, "provider", "medium", "on-request", ":workspace", [])`,
      ),
    );
    const installed = await execute("desktop.importLocalPlugin()");
    assert.deepEqual(installed, { pluginId: "style@local", displayName: "style" });
    assert.deepEqual(await execute("desktop.listLocalPlugins()"), [installed]);
    const selectedWorkspace = await execute("desktop.selectWorkspace()");
    assert.equal(selectedWorkspace, workspace);
    const thread = await execute(
      `desktop.createThread(${JSON.stringify(workspace)}, "provider", "medium", "on-request", ":workspace", [{pluginId: "style@local", origin: "local"}])`,
    );
    assert.equal(thread.mode, "local");
    const projectFile = join(thread.workspace, "原件.txt");
    await writeFile(projectFile, "workspace original");
    const externalFile = join(directory, "原件.txt");
    await writeFile(externalFile, "external original");
    // Supply disk-backed File objects through Chromium's actual file input.
    await execute(
      "document.body.appendChild(Object.assign(document.createElement('input'), {type:'file', id:'attachment'}))",
    );
    const debuggerAPI = window.webContents.debugger;
    debuggerAPI.attach();
    const { root } = await debuggerAPI.sendCommand("DOM.getDocument");
    const { nodeId } = await debuggerAPI.sendCommand("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#attachment",
    });
    const reference = async (path) => {
      await debuggerAPI.sendCommand("DOM.setFileInputFiles", { nodeId, files: [path] });
      return execute(
        `desktop.referenceFile(${JSON.stringify(thread.id)}, document.querySelector('#attachment').files[0])`,
      );
    };
    assert.equal(await reference(projectFile), "原件.txt");
    const imported = await reference(externalFile);
    assert.equal(await readFile(imported, "utf8"), "external original");
    debuggerAPI.detach();
    assert.equal(window.isVisible(), false);
    await execute(
      `desktop.send(${JSON.stringify(thread.id)}, [{ type: "text", text: "create file" }], ${JSON.stringify(randomUUID())})`,
    );
    let state;
    for (let i = 0; i < 200; i++) {
      state = await execute(`desktop.getThread(${JSON.stringify(thread.id)})`);
      if (state.status !== "running") break;
      await delay(50);
    }
    assert.equal(state.status, "idle", state.error ?? "Local assistant did not finish");
    assert.equal(await readFile(join(workspace, "demo.js"), "utf8"), "agent content");
    const file = await execute(`desktop.readFile(${JSON.stringify(thread.id)}, "demo.js")`);
    await execute(
      `desktop.writeFile(${JSON.stringify(thread.id)}, "demo.js", "user edit", ${JSON.stringify(file.hash)})`,
    );
    assert.equal(await readFile(join(workspace, "demo.js"), "utf8"), "user edit");
    await assert.rejects(
      execute(`desktop.writeFile(${JSON.stringify(thread.id)}, "demo.js", "stale", ${JSON.stringify(file.hash)})`),
    );
    await new Promise((resolve) => {
      window.webContents.once("did-finish-load", resolve);
      window.webContents.reload();
    });
    const restored = await execute(`desktop.getThread(${JSON.stringify(thread.id)})`);
    assert.equal(restored.messages.length, state.messages.length);
    await execute("desktop.clearSession()");
    await assert.rejects(execute("desktop.listThreads()"));
    process.stdout.write("ELECTRON_LOCAL_E2E_PASS\n");
  } catch (error) {
    process.stderr.write(String(error.stack ?? error));
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
    // Test workspaces alone are disposable; the application still executes its
    // ordinary graceful quit path before the harness removes the fixture.
    app.once("will-quit", () => {
      void rm(directory, { recursive: true, force: true });
    });
    app.quit();
  }
}
void run().catch((error) => {
  process.stderr.write(String(error.stack ?? error));
  app.exit(1);
});
