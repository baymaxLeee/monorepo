import assert from "node:assert/strict";
import test from "node:test";

import { conversationTitlePart, sanitizeConversationTitle } from "./generator.js";

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
