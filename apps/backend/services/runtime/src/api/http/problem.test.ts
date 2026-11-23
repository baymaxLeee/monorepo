import assert from "node:assert/strict";
import test from "node:test";

import { ConflictError } from "../../application/errors.js";
import { problemJson } from "./problem.js";

test("active Turn conflicts remain explicit HTTP conflicts", () => {
  assert.deepEqual(
    problemJson(new ConflictError("this session already has an active run", "active_run_exists", { run_id: "turn" })),
    {
      status: 409,
      body: {
        code: "active_run_exists",
        message: "this session already has an active run",
        details: { run_id: "turn" },
      },
    },
  );
});
