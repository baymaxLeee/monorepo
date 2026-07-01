import type { ModelMessage } from "ai";
import type { ChatProvider, ReasoningEffort } from "@backend/transport-ts/provider-model";

export type AgentMode = "normal" | "plan";

export interface AgentRuntimeContext {
  runId: string;
  userId: string;
  conversationId: string;
  profileId: AgentMode;
  runtimeKind: "tool-loop";
}

export interface ChatAgentInput {
  runId: string;
  userId: string;
  conversationId: string;
  mode: AgentMode;
  provider: ChatProvider;
  multimodalProviderId?: string | null;
  modelMessages: ModelMessage[];
  instructions: string;
  reasoningEffort?: ReasoningEffort | null;
}
