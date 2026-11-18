import assert from "node:assert/strict";
import test from "node:test";

import { defineUnavailableCapability } from "./manifest.js";
import { resolveAgentToolProfile } from "./profile.js";

function manifest(name: string, summary = name) {
  return defineUnavailableCapability(
    name,
    {
      capability: "external",
      effect: "none",
      trust: "closed",
      execution: "inline",
    },
    { summary },
  );
}

test("a specialist can opt into a narrow subset without inheriting every shared default", () => {
  const resolved = resolveAgentToolProfile({
    defaults: [manifest("web_search"), manifest("web_fetch"), manifest("subagents")],
    profile: { defaultTools: false, include: ["web_search", "web_fetch"] },
  });

  assert.deepEqual(
    resolved.map((candidate) => candidate.name),
    ["web_search", "web_fetch"],
  );
});

test("agent-owned additions can replace a default slot and be disabled by profile", () => {
  const resolved = resolveAgentToolProfile({
    defaults: [manifest("bash", "framework")],
    additions: [manifest("bash", "local executor"), manifest("media")],
    profile: { disable: ["media"] },
  });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.name, "bash");
  assert.equal(resolved[0]?.planning.summary, "local executor");
});

test("an unknown explicit capability fails closed", () => {
  assert.throws(
    () => resolveAgentToolProfile({ defaults: [manifest("web_search")], profile: { include: ["missing"] } }),
    /unknown tool missing/,
  );
});
