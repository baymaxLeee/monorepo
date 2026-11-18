import assert from "node:assert/strict";
import test from "node:test";

import { bashDescription } from "../tools/bash.js";
import { CORE_POLICY } from "./core-policy.js";
import { renderExecutionProtocol } from "./execution.js";
import { renderRuntimeContract } from "./runtime.js";

test("single HTML work avoids duplicate retrieval and per-run runtime harnesses", () => {
  const normal = renderRuntimeContract();

  assert.match(normal, /observe the result before fetching the same URL another way/i);
  assert.match(normal, /one Bash call when practical/i);
  assert.match(normal, /Do not install packages.*solely to revalidate/i);
});

test("fixed ECharts loader validation stays out of user runs", () => {
  assert.match(CORE_POLICY, /Do not download ECharts.*solely to revalidate/i);
  assert.doesNotMatch(CORE_POLICY, /verify platform-only success, platform failure followed by CDN success/i);
});

test("execution observes a retrieval before trying another path for the same source", () => {
  assert.match(renderExecutionProtocol(), /Observe a tool result before choosing another representation/i);
});

test("the primary loop chooses tools without a mandatory research router", () => {
  const execution = renderExecutionProtocol();
  const normal = renderRuntimeContract();

  assert.match(execution, /choose the smallest useful tool call/i);
  assert.match(execution, /do not add a router, classifier, or hidden workflow/i);
  assert.doesNotMatch(execution, /call subagents before synthesis/i);
  assert.match(normal, /preserve the user's requested scope.*shortest sufficient evidence-to-artifact path/i);
  assert.doesNotMatch(normal, /must use subagents first/i);
});

test("the model chooses the shortest path from tool-local capability facts", () => {
  const execution = renderExecutionProtocol();

  assert.match(execution, /shortest sufficient path to the user's core goal/i);
  assert.match(execution, /simple question must not expand/i);
  assert.match(execution, /tool call from its schema and description/i);
  assert.doesNotMatch(execution, /web_search directly|web_fetch directly|multiple independent searches/i);
  assert.match(bashDescription, /Prefer direct search\/fetch tools for factual public-web questions/i);
});
