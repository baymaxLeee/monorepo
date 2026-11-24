import type { AssistantModelMessage, ModelMessage, streamText, ToolSet } from "ai";
import { z } from "zod";

import type { ModelStreamRetryPolicy } from "../turn/model-retry.js";
import type { RuntimeTokenUsage } from "./usage.js";

export const remoteCheckpointSchema = z.strictObject({
  version: z.literal("responses-compaction-v2"),
  binding: z.string().min(1),
  itemId: z.string().min(1),
  encryptedContent: z.string().min(1),
});
export type RemoteCheckpoint = z.infer<typeof remoteCheckpointSchema>;

export interface RemoteCompactionInput {
  messages: ModelMessage[];
  instructions?: Parameters<typeof streamText>[0]["instructions"];
  tools?: ToolSet;
  signal?: AbortSignal;
  onUsage?(usage: RuntimeTokenUsage): void;
  retry?: ModelStreamRetryPolicy;
}

/** Optional provider-owned compaction port. The kernel persists only its opaque,
 * binding-fenced checkpoint and never constructs provider options itself. */
export interface RemoteCompactionAdapter {
  binding: string;
  compact(input: RemoteCompactionInput): Promise<{ state: RemoteCheckpoint; usage: RuntimeTokenUsage }>;
  isMessage(message: ModelMessage): boolean;
  message(checkpoint: RemoteCheckpoint): AssistantModelMessage;
}
