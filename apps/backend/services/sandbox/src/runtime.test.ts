import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

test("real shell supervisor lifecycle and file containment", async () => {
  const result = await promisify(execFile)(
    "python3",
    ["-m", "unittest", "discover", "-s", "runtime", "-p", "test_*.py"],
    {
      cwd: new URL("..", import.meta.url),
      timeout: 30000,
    },
  );
  assert.match(result.stderr, /OK/);
});
