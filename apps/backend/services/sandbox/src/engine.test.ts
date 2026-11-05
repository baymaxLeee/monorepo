import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEnv } from "node:util";

import { createApp } from "./app.js";
import { settings } from "./config.js";
import { filePath } from "./contracts.js";
import { Engine, resourceName } from "./engine.js";

const scope = {
  tenant_id: "tenant",
  workspace_id: "workspace",
  user_id: "user",
  conversation_id: "conversation",
  run_id: "run",
};
const config = settings({ ENVIRONMENT: "development" });

test("local Docker example selects runc explicitly without permitting production downgrade", () => {
  const env = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
  assert.equal(settings(env).runtime, "runc");
  assert.equal(settings(env).proxy, "http://127.0.0.1:3128");
  assert.throws(
    () =>
      settings({
        ...env,
        ENVIRONMENT: "production",
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ chat: "a".repeat(32) }),
      }),
    /require runsc/,
  );
});

test("scope binding rejects tenant/user/conversation/run substitution before runtime access", async () => {
  let touched = false;
  const engine = new Engine(config, async () => {
    touched = true;
    return "";
  });
  for (const field of Object.keys(scope)) {
    await assert.rejects(engine.assertOwner(resourceName(scope), { ...scope, [field]: "other" }), /scope mismatch/);
  }
  assert.equal(touched, false);
});

test("API refuses missing or foreign caller credentials, including session creation", async () => {
  const app = createApp(config);
  for (const headers of [{}, { "X-Caller-Service": "executor", "X-Internal-Token": config.chatToken }] as Record<
    string,
    string
  >[]) {
    const response = await app.request("/sessions", { method: "POST", headers, body: JSON.stringify(scope) });
    assert.equal(response.status, 401);
  }
});

test("Pod spec has no host mounts, service identity or writable root, and bounded lifetime", () => {
  const pod = new Engine(config).pod("sandbox-test", {}, {});
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.runtimeClassName, "runsc");
  assert.equal(pod.spec.containers[0].securityContext.readOnlyRootFilesystem, true);
  assert.equal(pod.spec.containers[0].securityContext.allowPrivilegeEscalation, false);
  assert.equal(pod.spec.activeDeadlineSeconds, config.ttlSeconds);
  assert.ok(pod.spec.volumes.every((v) => "emptyDir" in v));
});

test("configuration fails closed for production runtime downgrade and malformed limits", () => {
  assert.throws(() => settings({}), /strong Chat credential/);
  assert.throws(
    () => settings({ SANDBOX_RUNTIME: "runc", INTERNAL_SERVICE_TOKENS: JSON.stringify({ chat: "a".repeat(32) }) }),
    /require runsc/,
  );
  assert.throws(() => settings({ ENVIRONMENT: "development", SANDBOX_MEMORY_MIB: "0" }), /positive/);
  assert.throws(() => settings({ SANDBOX_BACKEND: "host" }), /invalid/);
});

test("transfer paths cannot select host or parent paths", () => {
  for (const path of ["/etc/passwd", "../x", "a/../x", "a//x", "a\\x", "x\u0000"]) assert.throws(() => filePath(path));
  assert.equal(filePath("sources/file.xlsx"), "sources/file.xlsx");
});

test("expired resource reaper preserves unexpired sandboxes", async () => {
  const deleted: string[] = [];
  const engine = new Engine(config);
  engine.list = async () => [
    { name: "old", labels: { "monorepo.sandbox.expires": "1" } },
    { name: "live", labels: { "monorepo.sandbox.expires": String(Date.now() + 100000) } },
  ];
  engine.remove = async (id) => {
    deleted.push(id);
  };
  await engine.reap();
  assert.deepEqual(deleted, ["old"]);
});

test("provisioning failure removes only the resource created by that attempt", async () => {
  const labels: Record<string, string> = {};
  const removed: string[] = [];
  const engine = new Engine(config, async (_exe, args) => {
    if (args[0] === "ps") return "";
    if (args[0] === "create") {
      for (let i = 0; i < args.length; i++)
        if (args[i] === "--label") {
          const [key, value] = args[i + 1].split("=");
          labels[key] = value;
        }
      return "created";
    }
    if (args[0] === "start") throw new Error("runtime unavailable");
    if (args[0] === "inspect") return JSON.stringify(labels);
    if (args[0] === "rm") {
      removed.push(args.at(-1)!);
      return "";
    }
    throw new Error("unexpected runtime action");
  });
  await assert.rejects(engine.create(scope), /runtime unavailable/);
  assert.deepEqual(removed, [resourceName(scope)]);
});

test("host admission refuses new resources when capacity is exhausted", async () => {
  const engine = new Engine({ ...config, maxSandboxes: 1 }, async () => {
    throw new Error("must not provision");
  });
  engine.list = async () => [{ name: "busy", labels: {} }];
  await assert.rejects(engine.create(scope), /capacity exhausted/);
});

test("API bounds command bodies and returns backpressure instead of queueing indefinitely", async () => {
  const engine = new Engine(config);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  engine.create = async () => {
    entered();
    await gate;
    return { id: "id", workdir: "/workspace/work", expires_at: "later" };
  };
  const app = createApp({ ...config, maxRequests: 1 }, engine);
  const headers = {
    "X-Caller-Service": "chat",
    "X-Internal-Token": config.chatToken,
    "Content-Type": "application/json",
  };
  const first = app.request("/sessions", { method: "POST", headers, body: JSON.stringify(scope) });
  await started;
  const denied = await app.request("/sessions", { method: "POST", headers, body: JSON.stringify(scope) });
  assert.equal(denied.status, 503);
  release();
  assert.equal((await first).status, 201);
  const large = await app.request("/sessions", { method: "POST", headers, body: "x".repeat(1048577) });
  assert.equal(large.status, 413);
});
