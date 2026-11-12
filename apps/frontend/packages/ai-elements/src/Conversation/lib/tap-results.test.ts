import { expect, test } from "vitest";

import { parseTapResults } from "./tap-results";

test("TAP respects failure, skip and TODO rather than counting them as passed", () => {
  const result = parseTapResults(
    "TAP version 13\nok 1 - 正常\nnot ok 2 - 失败\nok 3 - 环境 # SKIP unavailable\nnot ok 4 - 尚未实现 # TODO later\n1..4\n",
  );
  expect(result?.[0]?.tests.map((test) => test.status)).toEqual(["passed", "failed", "skipped", "skipped"]);
});
test.each([
  "all tests passed",
  "TAP version 13\nok 1 - partial\n1..2",
  "TAP version 13\nok 1\nBail out! stopped\n1..1",
  "TAP version 13\nok 2\n1..1",
  "TAP version 13\n1..0 # SKIP no tests",
  "TAP version 13\nok 1\n1..1\n1..1",
])("unverified report remains raw: %s", (value) => expect(parseTapResults(value)).toBeNull());
