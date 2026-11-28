import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import { restoreToolLoadout } from "./loadout.js";

test("tool loadout replay preserves first discovery order and ignores ordinary tools", () => {
  const messages = [
    {
      id: "a",
      role: "assistant",
      parts: [
        {
          type: "tool-tool_search",
          toolCallId: "search-1",
          state: "output-available",
          input: { query: "media" },
          output: { tools: [{ name: "generate_images" }, { name: "generate_video" }] },
        },
      ],
    },
    {
      id: "b",
      role: "assistant",
      parts: [
        {
          type: "tool-tool_search",
          toolCallId: "search-2",
          state: "output-available",
          input: { query: "video" },
          output: { tools: [{ name: "generate_video" }, { name: "mcp__docs__search" }] },
        },
        {
          type: "tool-bash",
          toolCallId: "bash",
          state: "output-available",
          input: {},
          output: { tools: [{ name: "ignored" }] },
        },
      ],
    },
  ] as UIMessage[];
  assert.deepEqual(restoreToolLoadout(messages), ["generate_images", "generate_video", "mcp__docs__search"]);
});
