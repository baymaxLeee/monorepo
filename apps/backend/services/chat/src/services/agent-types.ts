import type { WorkflowAgent } from "@ai-sdk/workflow";
import { z } from "zod";

import type { ChatWorkflowProvider, ReasoningEffort } from "./agent-provider.js";

type WorkflowStreamOptions = Parameters<WorkflowAgent["stream"]>[0];
export type WorkflowModelMessage = NonNullable<WorkflowStreamOptions["messages"]>[number];

export interface ChatWorkflowInput {
  runId: string;
  userId: string;
  conversationId: string;
  provider: ChatWorkflowProvider;
  multimodalProviderId?: string | null;
  modelMessages: WorkflowModelMessage[];
  instructions: string;
  reasoningEffort?: ReasoningEffort | null;
}

export const toolContextSchema = z.object({
  userId: z.string(),
  conversationId: z.string(),
  providerId: z.string(),
  multimodalProviderId: z.string().nullable().optional(),
});

export type ToolContext = z.infer<typeof toolContextSchema>;

export type ArtifactStreamData = {
  toolCallId: string;
  status: "generating" | "persisted" | "error";
  title: string;
  filename: string;
  kind: "html" | "markdown";
  preview?: string;
  generated_chars?: number;
  document_id?: string;
};
