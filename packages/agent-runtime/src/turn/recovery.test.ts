import assert from "node:assert/strict";
import test from "node:test";

import { classifyTurnRecovery, type TurnRecoveryBoundary } from "./recovery.js";

const boundary = (overrides: Partial<TurnRecoveryBoundary> = {}): TurnRecoveryBoundary => ({
  hasResumeEnvelope: true,
  cancellationRequested: false,
  waitingForClient: false,
  committedStep: false,
  toolEffect: "none",
  ...overrides,
});

test("recovery decisions are derived from durable boundaries", () => {
  assert.equal(classifyTurnRecovery(boundary({ waitingForClient: true })), "resume-waiting");
  assert.equal(classifyTurnRecovery(boundary({ committedStep: true })), "resume-next-step");
  assert.equal(classifyTurnRecovery(boundary()), "regenerate-model");
});

test("a committed effect without its journaled SDK step is not reconstructable", () => {
  assert.equal(classifyTurnRecovery(boundary({ toolEffect: "committed" })), "interrupt");
  assert.equal(classifyTurnRecovery(boundary({ committedStep: true, toolEffect: "committed" })), "resume-next-step");
});

test("unconfirmed effects require reconciliation before any replay", () => {
  assert.equal(
    classifyTurnRecovery(boundary({ hasResumeEnvelope: false, toolEffect: "unconfirmed" })),
    "reconcile-effect",
  );
});

test("cancellation and missing envelopes interrupt instead of guessing", () => {
  assert.equal(classifyTurnRecovery(boundary({ cancellationRequested: true, toolEffect: "unconfirmed" })), "interrupt");
  assert.equal(classifyTurnRecovery(boundary({ hasResumeEnvelope: false })), "interrupt");
});
