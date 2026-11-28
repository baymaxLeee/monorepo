import assert from "node:assert/strict";
import test from "node:test";

import { appendSchemaSearchText, rankToolSearch, tokenizeToolSearchText } from "./tool-search-ranker.js";

test("tool search tokenization keeps Chinese intent and identifier boundaries", () => {
  assert.deepEqual(tokenizeToolSearchText("搜索飞书审批 getApproval"), ["搜索", "飞", "书", "审批", "get", "approval"]);
});

test("tool search ranks exact names, namespaces and schema fields", () => {
  const schemaParts: string[] = [];
  appendSchemaSearchText(
    {
      type: "object",
      properties: { approval_code: { type: "string", description: "审批定义编码" } },
    },
    schemaParts,
  );
  const documents = [
    { name: "mcp__lark__create_approval", text: `创建审批 ${schemaParts.join(" ")}`, namespaceText: "飞书审批" },
    { name: "mcp__drive__search", text: "搜索云盘文件", namespaceText: "飞书云盘" },
  ];
  assert.equal(rankToolSearch("approval_code", documents, 8)[0]?.name, "mcp__lark__create_approval");
  assert.equal(rankToolSearch("飞书审批", documents, 8)[0]?.name, "mcp__lark__create_approval");
});
