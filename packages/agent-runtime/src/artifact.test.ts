import assert from "node:assert/strict";
import test from "node:test";

import type { Tool } from "ai";

import { createUploadArtifactsTool, fileDataChunks } from "./artifact.js";
import { isToolOutcome } from "./outcome.js";

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

test("cloud upload tool batches files and enforces create/update invariants", async () => {
  const calls: string[] = [];
  const manifest = createUploadArtifactsTool(async (input, options) => {
    calls.push(options.toolCallId);
    return { ...published, filename: input.operation === "create" ? input.filename : published.filename };
  });
  const definition = manifest.tool as Tool<unknown, unknown>;
  assert.ok(definition.execute);
  const result = await definition.execute(
    {
      artifacts: [
        {
          operation: "create",
          path: "demo.js",
          filename: "demo.js",
          media_type: "text/javascript",
          title: "demo.js",
          file_id: null,
          etag: null,
        },
        {
          operation: "update",
          path: "other.js",
          filename: null,
          media_type: null,
          title: null,
          file_id: published.file_id,
          etag: published.etag,
        },
      ],
    },
    { toolCallId: "save", messages: [], context: {} },
  );
  assert.ok(isToolOutcome(result) && result.status === "completed");
  assert.deepEqual(result.data, { files: [published, published] });
  assert.deepEqual(calls, ["save:0", "save:1"]);

  const invalid = await definition.execute(
    {
      artifacts: [
        {
          operation: "update",
          path: "demo.js",
          filename: "demo.js",
          media_type: null,
          title: null,
          file_id: published.file_id,
          etag: published.etag,
        },
      ],
    },
    { toolCallId: "save", messages: [], context: {} },
  );
  assert.ok(isToolOutcome(invalid) && invalid.status === "failed");
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
