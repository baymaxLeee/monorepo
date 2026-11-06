import assert from "node:assert/strict";
import test from "node:test";

import { CORE_POLICY } from "./core-policy.js";
import { renderExecutionProtocol } from "./execution.js";
import { renderRuntimeContract } from "./runtime.js";

test("single HTML work avoids duplicate retrieval and per-run runtime harnesses", () => {
  const normal = renderRuntimeContract("normal");

  assert.match(normal, /observe the result before fetching the same URL another way/i);
  assert.match(normal, /one Bash call when practical/i);
  assert.match(normal, /Do not install packages.*solely to revalidate/i);
});

test("fixed ECharts loader validation stays out of user runs", () => {
  assert.match(CORE_POLICY, /Do not download ECharts.*solely to revalidate/i);
  assert.doesNotMatch(CORE_POLICY, /verify platform-only success, platform failure followed by CDN success/i);
});

test("execution observes a retrieval before trying another path for the same source", () => {
  assert.match(renderExecutionProtocol(), /Do not fetch the same source through another path in the same step/i);
});
