import type { ModelMessage } from "ai";
import type { ChatProvider, ReasoningEffort } from "@backend/transport-ts/provider-model";
import type { ProviderSnapshot } from "../../clients/admin.js";

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
  // Agent's image provider snapshot (used inline by generate_image) and video
  // provider id (passed by reference to the executor video task). Null when the
  // agent hasn't configured that capability — the tool is then not mounted.
  imageProvider?: ProviderSnapshot | null;
  videoProviderId?: string | null;
  modelMessages: ModelMessage[];
  instructions: string;
  reasoningEffort?: ReasoningEffort | null;
}
