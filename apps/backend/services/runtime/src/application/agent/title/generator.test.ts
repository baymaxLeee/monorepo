import assert from "node:assert/strict";
import test from "node:test";

import { conversationTitlePart, generateConversationTitlePart, sanitizeConversationTitle } from "./generator.js";

const provider = {
  id: "provider-id",
  name: "Provider",
  model: "gpt-test",
  baseUrl: "https://8.8.8.8/responses",
  apiKey: "secret",
  extraBody: {},
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
};

function titleResponse(text: string): Response {
  return Response.json({
    id: "resp_title",
    object: "response",
    created_at: 1_700_000_000,
    model: "gpt-test",
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        id: "msg_title",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}

test("conversation title is sanitized and emitted as one transient data part", () => {
  const title = sanitizeConversationTitle("标题： “修复 Chat 标题推送！！” ");
  assert.equal(title, "修复 Chat 标题推送");
  assert.deepEqual(conversationTitlePart(title), {
    type: "data-conversation-title",
    data: { title: "修复 Chat 标题推送" },
    transient: true,
  });
});

test("conversation title is bounded by Unicode characters", () => {
  const title = sanitizeConversationTitle("会".repeat(41));
  assert.equal([...title].length, 41);
  assert.equal(title, `${"会".repeat(40)}…`);
});

test("conversation title retries a transient model disconnect at the current call", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    return titleResponse("修复长会话可靠性");
  });

  const part = await generateConversationTitlePart({ provider, userText: "请修复长会话可靠性" });

  assert.equal(calls, 2);
  assert.deepEqual(part, conversationTitlePart("修复长会话可靠性"));
});
