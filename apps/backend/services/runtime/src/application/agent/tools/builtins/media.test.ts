import assert from "node:assert/strict";
import test from "node:test";

import { createMediaToolManifests } from "./media.js";

test("media tools expose blocking durable generation without a production workbench", () => {
  const manifests = createMediaToolManifests();
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["list_media_models", "generate_images", "generate_video"],
  );
  assert.equal(
    manifests.some((manifest) => manifest.name === "prepare_media_generation"),
    false,
  );
  assert.equal(
    manifests.some((manifest) => manifest.name === "create_video_production"),
    false,
  );

  for (const name of ["generate_images", "generate_video"]) {
    const manifest = manifests.find((candidate) => candidate.name === name);
    assert.equal(manifest?.policy.execution, "durable");
    assert.equal(manifest?.planning.parallelizable, false);
    const description = manifest?.tool?.description;
    assert.equal(typeof description, "string");
    if (typeof description !== "string") throw new Error(`${name} must have a static description`);
    assert.match(description, /returns only after/i);
    assert.match(manifest?.planning.prerequisites?.join("\n") ?? "", /final work-producing tool/i);
    assert.doesNotMatch(JSON.stringify(manifest), /production_id|confirmation_id/i);
  }
});
