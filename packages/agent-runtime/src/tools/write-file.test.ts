import assert from "node:assert/strict";
import test from "node:test";

import { writeFileInputSchema } from "./write-file.js";

test("write_file defaults an omitted mode to the safe create operation", () => {
  assert.deepEqual(writeFileInputSchema.parse({ path: "report.md", content: "done\n" }), {
    path: "report.md",
    content: "done\n",
    mode: "create",
  });
});

test("write_file still requires an observed digest for overwrite", () => {
  assert.throws(
    () => writeFileInputSchema.parse({ path: "report.md", content: "updated\n", mode: "overwrite" }),
    /overwrite requires expected_sha256/,
  );
});
