import assert from "node:assert/strict";
import test from "node:test";

import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";

import { addUsage, EMPTY_USAGE } from "../observability/lifecycle.js";
import { compactConversationPrefix } from "./compactor.js";

const provider: LanguageProviderSnapshot = {
  id: "provider-id",
  name: "Provider",
  model: "gpt-test",
  responsesDialect: "openai_responses",
  baseUrl: "https://8.8.8.8/v1",
  apiKey: "secret",
  extraBody: {},
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
};

void test("does not treat an unavailable compactor as completed coverage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "unavailable" } }, { status: 503 });
  try {
    await assert.rejects(
      compactConversationPrefix({
        runId: "run-id",
        conversationId: "conversation-id",
        provider,
        messages: [{ id: "message-id", role: "user", parts: [{ type: "text", text: "retain this fact" }] }],
        previous: null,
        abortSignal: new AbortController().signal,
      }),
      /unavailable|503|failed/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("reports successful batch usage before a later compaction batch fails", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount > 1) {
      return Response.json({ error: { message: "later batch failed" } }, { status: 400 });
    }
    return Response.json({
      id: "resp_compaction",
      object: "response",
      created_at: 1_700_000_000,
      model: "gpt-test",
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_compaction",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                summary: "retained history",
                goals: [],
                constraints: [],
                decisions: [],
                completedWork: [],
                openQuestions: [],
              }),
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        total_tokens: 12,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  };
  let observed = EMPTY_USAGE;
  try {
    await assert.rejects(
      compactConversationPrefix({
        runId: "run-id",
        conversationId: "conversation-id",
        provider: { ...provider, contextWindow: 2_000, maxOutputTokens: 512 },
        messages: [
          { id: "first", role: "user", parts: [{ type: "text", text: "a".repeat(4_000) }] },
          { id: "second", role: "user", parts: [{ type: "text", text: "b".repeat(4_000) }] },
        ],
        previous: null,
        abortSignal: new AbortController().signal,
        onUsage: (usage) => {
          observed = addUsage(observed, usage);
        },
      }),
      /later batch failed|400/i,
    );
    assert.deepEqual(observed, {
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 12,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
