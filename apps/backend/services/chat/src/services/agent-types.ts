import type { ModelMessage } from "ai";
import { z } from "zod";

import type { ChatProvider, ReasoningEffort } from "./agent-provider.js";

export interface ChatAgentInput {
  runId: string;
  userId: string;
  conversationId: string;
  provider: ChatProvider;
  multimodalProviderId?: string | null;
  modelMessages: ModelMessage[];
  memorySourceText: string;
  instructions: string;
  reasoningEffort?: ReasoningEffort | null;
}

export const toolContextSchema = z.object({
  runId: z.string(),
  userId: z.string(),
  conversationId: z.string(),
  providerId: z.string(),
  multimodalProviderId: z.string().nullable().optional(),
});

export type ToolContext = z.infer<typeof toolContextSchema>;
