import type { LanguageModelV4 } from "@ai-sdk/provider";
import { streamText, type AssistantModelMessage, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";

import { runtimeTokenUsage, type RuntimeTokenUsage } from "./usage.js";

export const remoteCheckpointSchema = z.strictObject({
  version: z.literal("responses-compaction-v2"),
  binding: z.string().min(1),
  itemId: z.string().min(1),
  encryptedContent: z.string().min(1),
});
export type RemoteCheckpoint = z.infer<typeof remoteCheckpointSchema>;

export function remoteCompactionMessage(checkpoint: RemoteCheckpoint): AssistantModelMessage {
  const { itemId, encryptedContent } = checkpoint;
  return {
    role: "assistant",
    content: [
      {
        type: "custom",
        kind: "openai.compaction",
        providerOptions: { openai: { type: "compaction", itemId, encryptedContent } },
      },
    ],
  };
}

/** Codex V2 requests a compaction_trigger and installs the returned encrypted response item. */
export async function compactRemote(input: {
  model: LanguageModelV4;
  binding: string;
  messages: ModelMessage[];
  instructions?: Parameters<typeof streamText>[0]["instructions"];
  tools?: ToolSet;
  signal?: AbortSignal;
  onUsage?(usage: RuntimeTokenUsage): void;
}) {
  const result = streamText({
    model: input.model,
    messages: input.messages,
    instructions: input.instructions,
    // Tool descriptions remain part of the prompt. A compaction request never dispatches a tool.
    tools:
      input.tools &&
      Object.fromEntries(
        Object.entries(input.tools).map(([name, definition]) => [
          name,
          {
            ...definition,
            execute: undefined,
            onInputStart: undefined,
            onInputDelta: undefined,
            onInputAvailable: undefined,
            needsApproval: undefined,
          },
        ]),
      ),
    toolChoice: "none",
    providerOptions: { openai: { store: false, compactionTrigger: true } },
    abortSignal: input.signal,
  });
  const [content, usage] = await Promise.all([result.content, result.usage]);
  const consumed = runtimeTokenUsage(usage);
  input.onUsage?.(consumed);
  const items = content.filter((part) => part.type === "custom" && part.kind === "openai.compaction");
  if (items.length !== 1 || items[0]?.type !== "custom" || content.some((part) => part.type === "tool-call")) {
    throw new Error("Responses compaction did not return a single compaction item");
  }
  const meta = items[0].providerMetadata?.openai;
  const state = remoteCheckpointSchema.parse({
    version: "responses-compaction-v2",
    binding: input.binding,
    itemId: meta?.itemId,
    encryptedContent: meta?.encryptedContent,
  });
  return { state, usage: consumed };
}
