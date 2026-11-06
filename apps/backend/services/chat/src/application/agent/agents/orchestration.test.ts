import assert from "node:assert/strict";
import test from "node:test";

import { MAX_AGENT_STEPS, deriveOrchestrationState, resolveOrchestrationDirective } from "./orchestration.js";

test("uses a truth-aware model summary at the final step", () => {
  const state = deriveOrchestrationState({ executionPlanDocumentId: null }, []);

  assert.equal(MAX_AGENT_STEPS, 50);
  assert.deepEqual(resolveOrchestrationDirective(state, 19), { kind: "default" });

  const directive = resolveOrchestrationDirective(state, MAX_AGENT_STEPS - 1);

  assert.equal(directive.kind, "final-summary");
});

test("keeps the deterministic failure response when a selected plan was not read", () => {
  const state = deriveOrchestrationState({ executionPlanDocumentId: "plans/report-plan.md" }, []);

  const directive = resolveOrchestrationDirective(state, MAX_AGENT_STEPS - 1);

  assert.deepEqual(directive, {
    kind: "final",
    instruction: "本轮已保留已生成的产物，但选定的 Plan 尚未完整读取。请根据上方工具卡片中的结果继续处理。",
  });
});
