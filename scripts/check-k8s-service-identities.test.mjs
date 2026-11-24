import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-k8s-service-identities.py", import.meta.url));

function encoded(value) {
  return Buffer.from(value).toString("base64");
}

function secret(name, values) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name },
    data: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encoded(value)])),
  };
}

function validSecrets() {
  const tokens = {
    admin: "admin-sensitive-token",
    canvas: "canvas-sensitive-token",
    chat: "chat-sensitive-token",
    knowledge: "knowledge-sensitive-token",
    runtime: "runtime-sensitive-token",
  };
  return {
    apiVersion: "v1",
    kind: "List",
    items: [
      secret("admin-secrets", {
        INTERNAL_API_TOKEN: tokens.admin,
        INTERNAL_SERVICE_TOKENS: JSON.stringify({
          canvas: tokens.canvas,
          chat: tokens.chat,
          knowledge: tokens.knowledge,
        }),
      }),
      secret("canvas-secrets", {
        INTERNAL_API_TOKEN: tokens.canvas,
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: tokens.runtime }),
      }),
      secret("chat-secrets", { INTERNAL_API_TOKEN: tokens.chat }),
      secret("knowledge-secrets", {
        INTERNAL_API_TOKEN: tokens.knowledge,
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: tokens.runtime }),
      }),
      secret("runtime-server-secrets", {
        INTERNAL_API_TOKEN: tokens.runtime,
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ chat: tokens.chat }),
      }),
      secret("runtime-worker-secrets", {
        INTERNAL_API_TOKEN: tokens.runtime,
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: tokens.runtime }),
      }),
      secret("runtime-sandbox-secrets", {
        INTERNAL_SERVICE_TOKENS: JSON.stringify({ runtime: tokens.runtime }),
      }),
      secret("storage-secrets", {
        INTERNAL_SERVICE_TOKENS: JSON.stringify({
          admin: tokens.admin,
          canvas: tokens.canvas,
          knowledge: tokens.knowledge,
          runtime: tokens.runtime,
        }),
      }),
    ],
  };
}

function run(document) {
  return spawnSync("python3", [script], {
    input: JSON.stringify(document),
    encoding: "utf8",
  });
}

test("production service identity preflight accepts a complete credential graph", () => {
  const result = run(validSecrets());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight passed/);
});

test("production service identity preflight rejects missing required keys", () => {
  const document = validSecrets();
  delete document.items.find((item) => item.metadata.name === "admin-secrets").data.INTERNAL_API_TOKEN;
  const result = run(document);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /admin-secrets is missing required key INTERNAL_API_TOKEN/);
});

test("production service identity preflight rejects mismatched tokens without leaking values", () => {
  const document = validSecrets();
  const storage = document.items.find((item) => item.metadata.name === "storage-secrets");
  storage.data.INTERNAL_SERVICE_TOKENS = encoded(
    JSON.stringify({
      admin: "wrong-sensitive-token",
      canvas: "canvas-sensitive-token",
      knowledge: "knowledge-sensitive-token",
      runtime: "runtime-sensitive-token",
    }),
  );
  const result = run(document);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /storage-secrets INTERNAL_SERVICE_TOKENS entry admin/);
  assert.doesNotMatch(result.stderr, /wrong-sensitive-token|admin-sensitive-token/);
});

test("production service identity preflight rejects token reuse without leaking values", () => {
  const document = validSecrets();
  const chat = document.items.find((item) => item.metadata.name === "chat-secrets");
  chat.data.INTERNAL_API_TOKEN = encoded("admin-sensitive-token");
  const result = run(document);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tokens must be unique per caller/);
  assert.doesNotMatch(result.stderr, /admin-sensitive-token/);
});
