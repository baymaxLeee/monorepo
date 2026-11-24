import assert from "node:assert/strict";
import test from "node:test";

import { status, type ServiceError } from "@grpc/grpc-js";

import { InnerApiCaller, InnerApiError } from "./client.js";

test("adds caller identity and normalized metadata", () => {
  const caller = new InnerApiCaller("runtime", "runtime-secret");
  const metadata = caller.metadata({ "X-Request-ID": "request-1" });

  assert.deepEqual(metadata.get("x-caller-service"), ["runtime"]);
  assert.deepEqual(metadata.get("x-internal-token"), ["runtime-secret"]);
  assert.deepEqual(metadata.get("x-request-id"), ["request-1"]);
});

test("maps grpc failures to the stable inner API error", () => {
  const caller = new InnerApiCaller("runtime", "runtime-secret");
  const cause = Object.assign(new Error("transport failure"), {
    code: status.UNAVAILABLE,
    details: "knowledge unavailable",
    metadata: undefined,
  }) as unknown as ServiceError;

  const error = caller.error(cause);

  assert.ok(error instanceof InnerApiError);
  assert.equal(error.code, status.UNAVAILABLE);
  assert.equal(error.message, "knowledge unavailable");
  assert.equal(error.cause, cause);
});

test("rejects attempts to override transport-owned metadata", () => {
  const caller = new InnerApiCaller("runtime", "runtime-secret");

  assert.throws(() => caller.metadata({ "X-Caller-Service": "chat" }), /transport-owned/);
  assert.throws(() => caller.metadata({ "X-Internal-Token": "forged" }), /transport-owned/);
  assert.throws(() => caller.metadata({ "grpc-timeout": "1S" }), /transport-owned/);
});
