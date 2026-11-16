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
  const env = parseEnv(readFileSync(new URL("../../../.env.sandbox.example", import.meta.url), "utf8"));
  const local = { ...env, INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: "dev-runtime-internal-token" }) };
  assert.equal(settings(local).runtime, "runc");
  assert.equal(settings(local).proxy, "http://127.0.0.1:3128");
  assert.throws(
    () =>
      settings({
        ...local,
        ENVIRONMENT: "production",
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: "a".repeat(32) }),
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
  for (const headers of [{}, { "X-Caller-Service": "chat", "X-Internal-Token": config.runtimeToken }] as Record<
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
  assert.deepEqual(pod.spec.containers[0].securityContext.capabilities, {
    drop: ["ALL"],
    add: ["SETUID", "SETGID", "CHOWN", "KILL", "DAC_OVERRIDE"],
  });
  assert.equal(pod.spec.activeDeadlineSeconds, config.ttlSeconds);
  assert.ok(pod.spec.volumes.every((v) => "emptyDir" in v));
});

test("configuration fails closed for production runtime downgrade and malformed limits", () => {
  assert.throws(() => settings({}), /strong Runtime credential/);
  assert.throws(
    () => settings({ SANDBOX_RUNTIME: "runc", INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: "a".repeat(32) }) }),
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

test("workspace edit uses a scoped runtime fence", async () => {
  const controls: object[] = [];
  const engine = new Engine(config);
  engine.assertOwner = async () => {};
  (engine as unknown as { control(id: string, input: object): Promise<unknown> }).control = async (_id, input) => {
    controls.push(input);
    if ((input as { op: string }).op === "begin_workspace_edit") {
      return { token: (input as { token: string }).token };
    }
    return { released: true };
  };
  const acquired = await engine.acquireWorkspaceEdit("sandbox", scope, "edit-token");
  assert.deepEqual(acquired, { token: "edit-token" });
  assert.deepEqual(await engine.releaseWorkspaceEdit("sandbox", scope, acquired.token), { released: true });
  assert.deepEqual(controls, [
    { op: "begin_workspace_edit", token: "edit-token" },
    { op: "end_workspace_edit", token: "edit-token" },
  ]);
});

test("workspace edit API preserves the caller operation token", async () => {
  const engine = new Engine(config);
  let acquired = "";
  let released = "";
  engine.acquireWorkspaceEdit = async (_id, _scope, token) => {
    acquired = token ?? "";
    return { token: token ?? "generated" };
  };
  engine.releaseWorkspaceEdit = async (_id, _scope, token) => {
    released = token;
    return { released: true };
  };
  const app = createApp(config, engine);
  const headers = {
    "X-Caller-Service": "runtime",
    "X-Internal-Token": config.runtimeToken,
    "X-Sandbox-Scope": JSON.stringify(scope),
    "X-Sandbox-Workspace-Edit": "user-save-1",
    "Content-Type": "application/json",
  };
  const begin = await app.request("/sessions/sandbox/workspace-edits", { method: "POST", headers });
  assert.equal(begin.status, 201);
  assert.equal(acquired, "user-save-1");
  const end = await app.request("/sessions/sandbox/workspace-edits", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ token: "user-save-1" }),
  });
  assert.equal(end.status, 200);
  assert.equal(released, "user-save-1");
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
    "X-Caller-Service": "runtime",
    "X-Internal-Token": config.runtimeToken,
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

test("create refuses a closing existing guest", async () => {
  const engine = new Engine(config);
  engine.list = async () => [
    { name: resourceName(scope), labels: { "monorepo.sandbox.expires": String(Date.now() + 100000) } },
  ];
  engine.assertOwner = async () => {};
  engine.control = async () => ({ ready: false });
  await assert.rejects(engine.create(scope), /not ready/);
});

test("aborted admission never touches the container runtime", async () => {
  let calls = 0;
  const engine = new Engine(config, async () => {
    calls++;
    return "";
  });
  await assert.rejects(engine.create(scope, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("reaper removes managed resources with missing or malformed deadlines", async () => {
  const engine = new Engine(config);
  engine.list = async () => [
    { name: "missing", labels: {} as Record<string, string> },
    { name: "invalid", labels: { "monorepo.sandbox.expires": "NaN" } },
    { name: "infinite", labels: { "monorepo.sandbox.expires": "Infinity" } },
  ];
  const removed: string[] = [];
  engine.remove = async (name) => {
    removed.push(name);
  };
  await engine.reap();
  assert.deepEqual(removed.sort(), ["infinite", "invalid", "missing"]);
});
