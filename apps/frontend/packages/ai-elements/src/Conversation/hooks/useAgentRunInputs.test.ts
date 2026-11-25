import type { AgentRunInputStatus } from "@repo/api/chat";
import { expect, test } from "vitest";

import { reconcilePendingInputs, removeDeliveredPendingInputs } from "./useAgentRunInputs";

const accepted: AgentRunInputStatus = {
  clientMessageId: "input",
  mode: "follow-up",
  reason: null,
  runId: "run",
  state: "accepted",
  stepNumber: null,
  text: "continue",
};

test("unchanged polling results preserve pending input identities", () => {
  const current = [accepted];
  const result = reconcilePendingInputs(current, [{ ...accepted }]);

  expect(result).toBe(current);
  expect(result[0]).toBe(accepted);
});

test("real pending state transitions replace or remove the row", () => {
  const current = [accepted];
  const dispatching = { ...accepted, state: "dispatching" as const };

  expect(reconcilePendingInputs(current, [dispatching])).toEqual([dispatching]);
  expect(reconcilePendingInputs(current, [{ ...accepted, state: "delivered" }])).toEqual([]);
});

test("stream delivery events only update the pending state when an id matches", () => {
  const current = [accepted];

  expect(removeDeliveredPendingInputs(current, new Set())).toBe(current);
  expect(removeDeliveredPendingInputs(current, new Set(["another-input"]))).toBe(current);
  expect(removeDeliveredPendingInputs(current, new Set([accepted.clientMessageId]))).toEqual([]);
});
