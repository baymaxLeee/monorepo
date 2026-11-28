import assert from "node:assert/strict";
import test from "node:test";

import { asSchema } from "ai";

import { createMediaToolManifests } from "./media.js";

test("media tools expose fixed-model durable generation with explicit user-confirmed parameters", async () => {
  const manifests = createMediaToolManifests();
  assert.deepEqual(
    manifests.map((manifest) => manifest.name),
    ["generate_images", "generate_video"],
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
    assert.match(manifest?.planning.prerequisites?.join("\n") ?? "", /ask_user/i);
    assert.match(manifest?.planning.prerequisites?.join("\n") ?? "", /final work-producing tool/i);
    assert.doesNotMatch(JSON.stringify(manifest), /production_id|confirmation_id/i);
  }

  const imageSchema = await asSchema(manifests[0]!.tool!.inputSchema).jsonSchema;
  const videoSchema = await asSchema(manifests[1]!.tool!.inputSchema).jsonSchema;
  assert.deepEqual(imageSchema.required?.sort(), ["aspect_ratio", "prompts", "resolution"]);
  assert.deepEqual(videoSchema.required?.sort(), ["duration_seconds", "prompt", "ratio", "resolution"]);
  assert.equal(JSON.stringify([imageSchema, videoSchema]).includes("provider_id"), false);
  assert.match(manifests[0]?.tool?.description?.toString() ?? "", /Seedream/);
  assert.match(manifests[1]?.tool?.description?.toString() ?? "", /Seedance 2\.5/);
});
