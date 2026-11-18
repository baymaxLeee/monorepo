import assert from "node:assert/strict";
import test from "node:test";

import type { JSONValue } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";

import { assertMediaGenerationConfirmed, mediaConfirmationId } from "./media.js";

function result(toolCallId: string, toolName: string, data: JSONValue): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "json", value: { ok: true, status: "completed", data } },
      },
    ],
  };
}

function confirmedHistory(confirmationId: string): ModelMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: "生成图片" }] },
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "list", toolName: "list_media_models", input: { kind: "image" } }],
    },
    result("list", "list_media_models", {
      kind: "image",
      models: [{ id: "image-provider", name: "Image", model: "image-model", is_default: true }],
    }),
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "select",
          toolName: "ask_user",
          input: { questions: [{ id: "media_model_selection" }] },
        },
      ],
    },
    result("select", "ask_user", {
      answers: [{ id: "media_model_selection", values: ["image-provider"] }],
    }),
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "prepare",
          toolName: "prepare_media_generation",
          input: { kind: "image", configuration: { provider_id: "image-provider", prompts: ["prompt"] } },
        },
      ],
    },
    result("prepare", "prepare_media_generation", { kind: "image", confirmation_id: confirmationId }),
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "confirm",
          toolName: "ask_user",
          input: { questions: [{ id: "media_generation_configuration" }] },
        },
      ],
    },
    result("confirm", "ask_user", {
      answers: [{ id: "media_generation_configuration", values: [confirmationId] }],
    }),
  ];
}

test("media generation requires a fresh model choice and a separate exact configuration confirmation", () => {
  const configuration = { provider_id: "image-provider", prompts: ["prompt"] };
  const confirmationId = mediaConfirmationId("image", configuration);
  const history = confirmedHistory(confirmationId);

  assert.doesNotThrow(() =>
    assertMediaGenerationConfirmed(
      "image",
      { ...configuration, confirmation_id: confirmationId },
      ["image-provider"],
      confirmationId,
      history,
    ),
  );
  assert.throws(
    () =>
      assertMediaGenerationConfirmed(
        "image",
        { ...configuration, prompts: ["changed"], confirmation_id: confirmationId },
        ["image-provider"],
        confirmationId,
        history,
      ),
    /changed after confirmation/,
  );
  assert.throws(
    () =>
      assertMediaGenerationConfirmed(
        "image",
        { ...configuration, confirmation_id: confirmationId },
        ["image-provider"],
        confirmationId,
        history.slice(0, -2),
      ),
    /not confirmed by the user/,
  );
});
