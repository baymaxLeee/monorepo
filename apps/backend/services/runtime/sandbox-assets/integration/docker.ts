import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout } from "node:timers/promises";

import { serve } from "@hono/node-server";

import { RuntimeSandboxClient, type SandboxProcess, type SandboxScope } from "#runtime/transport";

import { createApp } from "../../src/bootstrap/sandbox-app.js";
import { getSandboxSettings } from "../../src/config/sandbox.js";
import { command, Engine } from "../../src/sandbox/engine.js";

// This suite is separate from unit tests: missing Docker/proxy/runtime is a
// failure, never a skipped test reported as an integration pass.
const config = getSandboxSettings({
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
    const client = new RuntimeSandboxClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      callerService: "runtime",
      internalToken: config.runtimeToken,
    });
    const scope: SandboxScope = {
      session_id: "test",
      run_id: randomUUID(),
      attempt_epoch: "1",
    };
    let processId = 0;
    const sandbox = (allowedHosts: string[] = []) => ({
      attempt: 1 as const,
      sandboxed: true,
      permission_profile: {
        type: "managed" as const,
        file_system: {
          type: "restricted" as const,
          entries: [
            { path: "/", access: "read" as const },
            { path: "/workspace", access: "write" as const },
            { path: "/workspace/sources", access: "read" as const },
            { path: "/run/control", access: "deny" as const },
            { path: "/run/egress", access: "deny" as const },
          ],
        },
        network: { type: "restricted" as const, allowed_hosts: allowedHosts },
      },
      process: { process_id: ++processId, entry_id: randomUUID() },
    });
    const exitCode = (process: SandboxProcess) =>
      process.termination?.type === "exit" ? process.termination.exit_code : null;
    const startAt = performance.now();
    let id = "";
    const start = (script: string, extra: { tty?: boolean; yield_time_ms?: number; timeout_ms?: number } = {}) =>
      client.start(id, {
        scope,
        command: script,
        request_id: randomUUID(),
        workdir: "/workspace/work",
        env: {},
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 10000,
        sandbox: sandbox(),
        ...extra,
      });
    try {
      const session = await client.create(scope);
      id = session.id;
      t.diagnostic(`warm-image allocation: ${Math.round(performance.now() - startAt)}ms; runtime=${config.runtime}`);
      assert.equal((await client.create(scope)).id, id);
      const workspace = await start(
        "stat -c '%u:%g:%a' /workspace; printf '# Test document\\n' > /workspace/test.md; printf '<!doctype html><title>Test</title>' > /workspace/test.html",
      );
      assert.equal(exitCode(workspace), 0, workspace.stderr);
      assert.equal(workspace.stdout.trim(), "1000:1000:755");
      const markdown = await client.download(id, scope, "test.md");
      assert.equal(await new Response(markdown).text(), "# Test document\n");
      const html = await client.download(id, scope, "test.html");
      assert.equal(await new Response(html).text(), "<!doctype html><title>Test</title>");
      const capabilities = await start("grep -E '^Cap(Eff|Prm|Amb):' /proc/self/status");
      assert.equal(exitCode(capabilities), 0, capabilities.stderr);
      assert.equal(capabilities.stdout.trim().split("\n").length, 3);
      for (const line of capabilities.stdout.trim().split("\n")) assert.match(line, /:\s+0+$/);
      await client.upload(id, scope, "nested/restored.md", new Blob(["restored"]).stream());
      const restored = await start("cat /workspace/nested/restored.md; test -w /workspace/nested/restored.md");
      assert.equal(exitCode(restored), 0, restored.stderr);
      assert.equal(restored.stdout, "restored");
      const binary = Uint8Array.from([0, 255, 1, 128, 10, 13, 0]);
      await client.upload(id, scope, "sources/test.bin", new Blob([binary]).stream());
      const result = await start(
        "cp ../sources/test.bin ../outputs/copy.bin; python3 -c 'import os; print(os.getuid())'; node --version; curl --version | head -1; test ! -w /workspace/sources; test ! -r /run/control/runner.sock",
      );
      assert.equal(exitCode(result), 0, result.stderr);
      assert.match(result.stdout, /1000/);
      const body = await client.download(id, scope, "outputs/copy.bin");
      assert.deepEqual(new Uint8Array(await new Response(body).arrayBuffer()), binary);
      assert.equal(exitCode(await start("echo secret > x; ln -s /etc/passwd ../outputs/escape")), 0);
      await assert.rejects(client.download(id, scope, "outputs/escape"));
      await assert.rejects(
        client.start(id, {
          scope: { ...scope, run_id: "other" },
          request_id: "foreign",
          command: "true",
          workdir: "/workspace/work",
          env: {},
          tty: false,
          yield_time_ms: 0,
          timeout_ms: 1000,
          sandbox: sandbox(),
        }),
      );
      const request = {
        scope,
        request_id: "once",
        command: "echo once >> once",
        workdir: "/workspace/work",
        env: {},
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 1000,
        sandbox: sandbox(),
      };
      await client.start(id, request);
      await client.start(id, request);
      assert.equal((await start("wc -l < once")).stdout.trim(), "1");
      const pending = await start("read line; printf 'got:%s' \"$line\"", { tty: true, yield_time_ms: 0 });
      assert.equal(pending.termination, null);
      const continued = await client.write(id, pending.session_id, {
        scope,
        request_id: "stdin",
        chars: "hello\n",
        stdout_offset: 0,
        stderr_offset: 0,
        yield_time_ms: 1000,
      });
      assert.match(continued.stdout, /got:hello/);
      assert.equal(exitCode(continued), 0);
      const pipe = await client.start(id, {
        ...request,
        command: "cat",
        request_id: randomUUID(),
        sandbox: sandbox(),
        binary_io: true,
        pipe_stdin: true,
        yield_time_ms: 0,
        timeout_ms: 10000,
      });
      await client.write(id, pipe.session_id, {
        scope,
        request_id: randomUUID(),
        chars: "",
        stdin_base64: Buffer.from(binary).toString("base64"),
        stdout_offset: 0,
        stderr_offset: 0,
        yield_time_ms: 0,
      });
      const echoed = await client.write(id, pipe.session_id, {
        scope,
        request_id: randomUUID(),
        chars: "",
        close_stdin: true,
        stdout_offset: 0,
        stderr_offset: 0,
        yield_time_ms: 1000,
      });
      assert.equal(exitCode(echoed), 0);
      assert.deepEqual(Buffer.from(echoed.stdout, "base64"), Buffer.from(binary));
      await t.test("approved public HTTPS through the sandbox proxy", async () => {
        const allow = await client.start(id, {
          scope,
          command: "curl -fsS --max-time 8 https://example.com -o /tmp/egress.html && head -c 100 /tmp/egress.html",
          request_id: randomUUID(),
          workdir: "/workspace/work",
          env: {},
          tty: false,
          yield_time_ms: 10_000,
          timeout_ms: 10_000,
          sandbox: sandbox(["example.com"]),
        });
        assert.equal(exitCode(allow), 0, allow.stderr);
        assert.ok(allow.stdout.length > 0, allow.stderr);
      });
      const denied = await start("curl -fsS --max-time 5 http://169.254.169.254/latest/meta-data", {
        yield_time_ms: 10000,
      });
      assert.notEqual(denied.termination, null);
      const bypass = await start("curl --noproxy '*' -fsS --max-time 2 http://1.1.1.1", { yield_time_ms: 10000 });
      assert.notEqual(bypass.termination, null);
      // A new controller has no in-memory session state; the same Pod/container
      // remains usable and has the expected original file bytes.
      const replacement = new Engine(config);
      const alive = await replacement.process(id, scope, {
        op: "start",
        request_id: "replacement",
        command: "cat x",
        workdir: "/workspace/work",
        env: {},
        tty: false,
        yield_time_ms: 1000,
        timeout_ms: 1000,
        sandbox: sandbox(),
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
      assert.equal((await start("printf still-usable")).stdout, "still-usable");
    } finally {
      await client.destroy(scope);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      assert.ok(!(await engine.list()).some((resource) => resource.name === id));
    }
  },
);

test("deployed egress modes apply to environment HTTP clients and always protect metadata", async (t) => {
  const image = process.env.SANDBOX_PROXY_IMAGE ?? "local/sandbox-proxy:latest";
  for (const mode of ["disabled", "allowlist", "public"]) {
    await t.test(mode, async () => {
      const name = `sandbox-policy-test-${randomUUID()}`;
      await command("docker", [
        "run",
        "-d",
        "--name",
        name,
        "--read-only",
        "--tmpfs",
        "/run",
        "--tmpfs",
        "/tmp",
        "-e",
        `SANDBOX_EGRESS_MODE=${mode}`,
        "-e",
        "SANDBOX_EGRESS_EXTRA_DOMAINS=example.org",
        image,
      ]);
      try {
        // Wait for Squid itself, then check both HTTP and HTTPS policy decisions.
        await command("docker", [
          "exec",
          name,
          "bash",
          "-ec",
          "for attempt in {1..100}; do if (: >/dev/tcp/127.0.0.1/3128) 2>/dev/null; then exit 0; fi; sleep .1; done; exit 1",
        ]);
        const curl = (url: string) =>
          command("docker", [
            "run",
            "--rm",
            "--network",
            `container:${name}`,
            "-e",
            "https_proxy=http://127.0.0.1:3128",
            "-e",
            "http_proxy=http://127.0.0.1:3128",
            "--entrypoint",
            "curl",
            config.image,
            "-fsS",
            "--max-time",
            "10",
            "-o",
            "/dev/null",
            url,
          ]);
        const python = (url: string) =>
          command("docker", [
            "run",
            "--rm",
            "--network",
            `container:${name}`,
            "-e",
            "https_proxy=http://127.0.0.1:3128",
            "-e",
            "http_proxy=http://127.0.0.1:3128",
            "--entrypoint",
            "python3",
            config.image,
            "-c",
            "import sys,urllib.request; urllib.request.urlopen(sys.argv[1], timeout=10).read(1)",
            url,
          ]);
        await assert.rejects(curl("http://169.254.169.254/"), /requested URL returned error: 403/i);
        if (mode === "disabled")
          await assert.rejects(curl("https://example.org"), /requested URL returned error: 403/i);
        else await Promise.all([curl("https://example.org"), python("https://example.com")]);
        if (mode === "public") await Promise.all([curl("https://example.net"), python("https://example.com")]);
        else await assert.rejects(curl("https://example.net"), /requested URL returned error: 403/i);
      } finally {
        await command("docker", ["rm", "-f", name]);
      }
    });
  }
  for (const setting of ["SANDBOX_EGRESS_MODE=unknown", "SANDBOX_EGRESS_EXTRA_DOMAINS=example.org,all *"]) {
    await assert.rejects(command("docker", ["run", "--rm", "-e", setting, image]), /Invalid SANDBOX_EGRESS/);
  }
});
