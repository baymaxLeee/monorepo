import assert from "node:assert/strict";
import test from "node:test";

import { MAX_AGENT_STEPS, deriveOrchestrationState, resolveOrchestrationDirective } from "./orchestration.js";

test("uses a truth-aware model summary at the final step", () => {
  const state = deriveOrchestrationState([]);

  assert.equal(MAX_AGENT_STEPS, 50);
  assert.deepEqual(resolveOrchestrationDirective(state, 19), { kind: "default" });

  const directive = resolveOrchestrationDirective(state, MAX_AGENT_STEPS - 1);

  assert.equal(directive.kind, "final-summary");
});
