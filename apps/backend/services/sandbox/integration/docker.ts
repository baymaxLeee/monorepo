import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout } from "node:timers/promises";

import { SandboxInternalClient, type SandboxScope } from "@backend/transport-ts";
import { serve } from "@hono/node-server";

import { createApp } from "../src/app.js";
import { settings } from "../src/config.js";
import { command, Engine } from "../src/engine.js";

// This suite is separate from unit tests: missing Docker/proxy/runtime is a
// failure, never a skipped test reported as an integration pass.
const config = settings({
  ...process.env,
  ENVIRONMENT: "development",
  SANDBOX_RUNTIME: process.env.SANDBOX_RUNTIME ?? "runc",
  SANDBOX_BACKEND: "docker",
  SANDBOX_PROXY_URL: "http://127.0.0.1:3128",
  SANDBOX_TTL_SECONDS: "120",
});
test(
  "real Docker + HTTP client: isolation, file bytes, PTY, egress, deadlines, controller replacement",
  { timeout: 90000 },
  async (t) => {
    const engine = new Engine(config);
    const app = createApp(config, engine);
    const server = serve({ fetch: app.fetch, port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = new SandboxInternalClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      callerService: "chat",
      internalToken: config.chatToken,
    });
    const scope: SandboxScope = {
      tenant_id: "test",
      workspace_id: "test",
      user_id: "test",
      conversation_id: "test",
      run_id: randomUUID(),
    };
    const startAt = performance.now();
    let id = "";
    const start = (script: string, extra: { tty?: boolean; yield_time_ms?: number; timeout_ms?: number } = {}) =>
      client.start(id, {
        scope,
        command: script,
        request_id: randomUUID(),
        workdir: "/workspace/work",
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 10000,
        ...extra,
      });
    try {
      const session = await client.create(scope);
      id = session.id;
      t.diagnostic(`warm-image allocation: ${Math.round(performance.now() - startAt)}ms; runtime=${config.runtime}`);
      assert.equal((await client.create(scope)).id, id);
      const binary = Uint8Array.from([0, 255, 1, 128, 10, 13, 0]);
      await client.upload(id, scope, "sources/test.bin", new Blob([binary]).stream());
      const result = await start(
        "cp ../sources/test.bin ../outputs/copy.bin; python3 -c 'import os; print(os.getuid())'; node --version; curl --version | head -1; test ! -w /workspace/sources; test ! -r /run/control/runner.sock",
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stdout, /1000/);
      const body = await client.download(id, scope, "outputs/copy.bin");
      assert.deepEqual(new Uint8Array(await new Response(body).arrayBuffer()), binary);
      assert.equal((await start("echo secret > x; ln -s /etc/passwd ../outputs/escape")).exitCode, 0);
      await assert.rejects(client.download(id, scope, "outputs/escape"));
      await assert.rejects(
        client.start(id, {
          scope: { ...scope, user_id: "other" },
          request_id: "foreign",
          command: "true",
          workdir: "/workspace/work",
          tty: false,
          yield_time_ms: 0,
          timeout_ms: 1000,
        }),
      );
      const request = {
        scope,
        request_id: "once",
        command: "echo once >> once",
        workdir: "/workspace/work",
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 1000,
      };
      await client.start(id, request);
      await client.start(id, request);
      assert.equal((await start("wc -l < once")).stdout.trim(), "1");
      const pending = await start("read line; printf 'got:%s' \"$line\"", { tty: true, yield_time_ms: 0 });
      assert.equal(pending.exitCode, null);
      const continued = await client.write(id, pending.session_id, {
        scope,
        request_id: "stdin",
        chars: "hello\n",
        stdout_offset: 0,
        stderr_offset: 0,
        yield_time_ms: 1000,
      });
      assert.match(continued.stdout, /got:hello/);
      assert.equal(continued.exitCode, 0);
      const allow = await start("curl -fsS --max-time 10 https://example.com | head -c 100");
      assert.equal(allow.exitCode, 0, allow.stderr);
      assert.ok(allow.stdout.length > 0, allow.stderr);
      const denied = await start("curl -fsS --max-time 5 http://169.254.169.254/latest/meta-data");
      assert.notEqual(denied.exitCode, 0);
      const bypass = await start("curl --noproxy '*' -fsS --max-time 2 http://1.1.1.1");
      assert.notEqual(bypass.exitCode, 0);
      // A new controller has no in-memory session state; the same Pod/container
      // remains usable and has the expected original file bytes.
      const replacement = new Engine(config);
      const alive = await replacement.process(id, scope, {
        op: "start",
        request_id: "replacement",
        command: "cat x",
        workdir: "/workspace/work",
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 1000,
      });
      assert.equal(alive.stdout, "secret\n");
      await start(
        'python3 -c \'import os,time; p=os.fork(); os.setsid() if p==0 else None; open("escaped.pid","w").write(str(os.getpid())) if p==0 else None; time.sleep(60)\'',
        { yield_time_ms: 0, timeout_ms: 500 },
      );
      await setTimeout(1200);
      // No poll or controller action triggers timeout cleanup. Inspect from the
      // trusted side: all guest processes must already be gone or zombies.
      const survivors = await command("docker", [
        "exec",
        id,
        "python3",
        "-I",
        "-c",
        "import pathlib; live=[]\nfor p in pathlib.Path('/proc').glob('[0-9]*/status'):\n try:\n  s=p.read_text(); live += [str(p)] if 'Uid:\\t1000\\t' in s and 'State:\\tZ' not in s else []\n except FileNotFoundError: pass\nprint(live)",
      ]);
      assert.equal(survivors.trim(), "[]");
    } finally {
      await client.destroy(scope);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      assert.ok(!(await engine.list()).some((resource) => resource.name === id));
    }
  },
);
