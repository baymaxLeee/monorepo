import assert from "node:assert/strict";
import test from "node:test";

import { seedanceCaps } from "./ark.js";

test("Seedance model generations keep their distinct duration capabilities", () => {
  assert.deepEqual(seedanceCaps("doubao-seedance-2-5-260628"), {
    maxClipSeconds: 30,
    durationField: "duration",
    multiImageReference: true,
  });
  assert.deepEqual(seedanceCaps("doubao-seedance-2-0-260128"), {
    maxClipSeconds: 15,
    durationField: "duration",
    multiImageReference: true,
  });
});
