import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageModelV4Prompt } from "@ai-sdk/provider";

import { estimateSessionContext, finalizeSessionContext, parseSessionContextSnapshot } from "./usage.js";

const prompt = [
  {
    role: "system",
    content: "<core_policy>Keep the user safe.</core_policy><execution_environment>desktop</execution_environment>",
  },
  { role: "user", content: [{ type: "text", text: "Continue the implementation." }] },
] as LanguageModelV4Prompt;

test("uses provider usage for the active-context total while keeping an estimated category split", () => {
  const estimate = estimateSessionContext({ prompt, toolSources: new Map() });
  const snapshot = finalizeSessionContext(estimate, {
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 10,
    reasoningTokens: 8,
    totalTokens: 120,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.inputTokens, 100);
  assert.equal(snapshot.retainedOutputTokens, 12);
  assert.equal(snapshot.usedTokens, 112);
  assert.equal(
    snapshot.categories.reduce((sum, category) => sum + category.tokens, 0),
    snapshot.usedTokens,
  );
  assert.ok(snapshot.categories.some((category) => category.id === "system"));
  assert.ok(snapshot.categories.some((category) => category.id === "session"));
});

test("falls back to the portable estimate before a provider reports usage", () => {
  const estimate = estimateSessionContext({ prompt, toolSources: new Map() });
  const snapshot = finalizeSessionContext(estimate, {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  });

  assert.ok(snapshot);
  assert.equal(
    snapshot.usedTokens,
    estimate.categories.reduce((sum, category) => sum + category.tokens, 0),
  );
});

test("rejects non-finite or negative persisted usage", () => {
  const valid = {
    version: 1,
    usedTokens: 10,
    inputTokens: 8,
    retainedOutputTokens: 2,
    breakdownEstimated: true,
    categories: [{ id: "session", tokens: 10 }],
  };

  assert.deepEqual(parseSessionContextSnapshot(valid), valid);
  assert.equal(parseSessionContextSnapshot({ ...valid, usedTokens: Number.NaN }), null);
  assert.equal(parseSessionContextSnapshot({ ...valid, inputTokens: -1 }), null);
  assert.equal(parseSessionContextSnapshot({ ...valid, categories: [{ id: "session", tokens: Infinity }] }), null);
});
