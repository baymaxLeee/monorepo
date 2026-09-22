import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { createCanvasToolManifests } from "./canvas.js";

test("storyboard tool submits planning input instead of Chat-prepared shots", () => {
  const manifest = createCanvasToolManifests({
    textProviderId: "text-provider",
    videoProviderId: "video-provider",
  }).find(({ name }) => name === "create_canvas_storyboard_drafts");
  assert.ok(manifest?.tool);
  const tool = manifest.tool;
  assert.ok("inputSchema" in tool);

  const schema = tool.inputSchema;
  assert.ok(schema instanceof z.ZodObject);
  assert.deepEqual(Object.keys(schema.shape).sort(), [
    "aspect_ratio",
    "canvas_node_duration_max_seconds",
    "canvas_node_duration_min_seconds",
    "generate_audio",
    "plot",
    "resolution",
    "total_duration_max_seconds",
    "total_duration_min_seconds",
    "watermark",
  ]);
});
