import assert from "node:assert/strict";
import test from "node:test";

import { bashNeedsApproval } from "./policy.js";

void test("request mode asks before network and sensitive shell operations", () => {
  assert.equal(bashNeedsApproval("rg TODO src", "request"), false);
  assert.equal(bashNeedsApproval("curl https://example.com", "request"), true);
  assert.equal(bashNeedsApproval("pnpm install", "request"), true);
  assert.equal(bashNeedsApproval("rm -rf build", "request"), true);
});

void test("auto mode permits routine network use but asks before sensitive operations", () => {
  assert.equal(bashNeedsApproval("curl https://example.com", "auto"), false);
  assert.equal(bashNeedsApproval("git fetch origin", "auto"), false);
  assert.equal(bashNeedsApproval("git reset --hard HEAD", "auto"), true);
  assert.equal(bashNeedsApproval("rm --recursive build", "auto"), true);
});

void test("full mode delegates every command to the OS sandbox boundary", () => {
  assert.equal(bashNeedsApproval("sudo rm -rf /", "full"), false);
});
