import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionEnvironment } from "./environment.js";
import { attachExecutionEnvironment } from "./environment.js";

const environment = {
  location: "cloud",
  workspace: {
    root: "/workspace",
    access: "read-write",
    isolation: "ephemeral",
    persistence: "session",
    externalSources: "read-only",
  },
  network: { access: "environment", protocols: ["http", "https"] },
  process: { shell: true, lifetime: "command", backgroundServices: "unsupported" },
  deliverables: "session-file",
  permissions: { profileId: ":workspace", enforcement: "managed", approvalPolicy: "on-request" },
} as const satisfies ExecutionEnvironment;

test("execution environment is inserted inside assembled instructions exactly once", () => {
  const once = attachExecutionEnvironment("<agent_instructions>\ncore\n</agent_instructions>", environment);
  const twice = attachExecutionEnvironment(once, environment);
  assert.equal((twice.match(/<execution_environment>/g) ?? []).length, 1);
  assert.match(twice, /"root":"\/workspace"/);
  assert.ok(twice.indexOf("<execution_environment>") < twice.indexOf("</agent_instructions>"));
});

test("invalid environment facts fail before a model call", () => {
  assert.throws(
    () =>
      attachExecutionEnvironment("core", {
        ...environment,
        network: { access: "disabled", protocols: ["https"] },
      }),
    /cannot advertise network protocols/,
  );
});
