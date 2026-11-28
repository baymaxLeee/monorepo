import assert from "node:assert/strict";
import test from "node:test";

import type { Tool } from "ai";

import { isToolOutcome } from "../core/outcome.js";
import { createUploadArtifactsTool, fileDataChunks } from "./artifacts.js";

const published = {
  file_id: "a".repeat(32),
  filename: "demo.js",
  title: "demo.js",
  media_type: "text/javascript",
  kind: "artifact",
  etag: `"${"b".repeat(32)}"`,
  updated: false,
  workspace_path: "demo.js",
};

test("deliverables use workspace paths and publish each selected file once", async () => {
  const calls: Array<{ toolCallId: string; artifactIndex: number }> = [];
  const manifest = createUploadArtifactsTool(async (path, options) => {
    calls.push({ toolCallId: options.toolCallId, artifactIndex: options.artifactIndex });
    return { ...published, filename: path };
  });
  const definition = manifest.tool as Tool<unknown, unknown>;
  assert.ok(definition.execute);
  const result = await definition.execute(
    { paths: ["demo.js", "other.js", "demo.js"] },
    { toolCallId: "save", messages: [], context: {} },
  );
  assert.ok(isToolOutcome(result) && result.status === "completed");
  assert.deepEqual(result.data, { files: [published, { ...published, filename: "other.js" }] });
  assert.deepEqual(calls, [
    { toolCallId: "save", artifactIndex: 0 },
    { toolCallId: "save", artifactIndex: 1 },
  ]);
});

test("a failed batch reports already published files and stops before the remaining drafts", async () => {
  const calls: string[] = [];
  const manifest = createUploadArtifactsTool(async (path) => {
    calls.push(path);
    if (path === "missing") throw new Error("file missing");
    return published;
  });
  const definition = manifest.tool as Tool<unknown, unknown>;
  assert.ok(definition.execute);
  const result = await definition.execute(
    { paths: ["demo.js", "missing", "later"] },
    { toolCallId: "save", messages: [], context: {} },
  );
  assert.ok(isToolOutcome(result) && result.status === "partial");
  assert.deepEqual(result.data, { files: [published] });
  assert.deepEqual(calls, ["demo.js", "missing"]);
});

test("terminal artifact tool output becomes an ordered persistent data part", () => {
  assert.deepEqual(
    fileDataChunks({
      type: "tool-output-available",
      toolCallId: "save",
      output: { ok: true, status: "completed", data: { files: [published] } },
      toolMetadata: { agent: { uiKind: "artifact" } },
    }),
    [{ type: "data-file", id: published.file_id, data: published }],
  );
  assert.deepEqual(
    fileDataChunks({
      type: "tool-output-available",
      toolCallId: "save",
      output: { ok: true, status: "completed", data: { files: [published] } },
      toolMetadata: { agent: { uiKind: "terminal" } },
    }),
    [],
  );
});
