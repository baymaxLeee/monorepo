import type { ModelMessage } from "ai";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import type { ProviderSnapshot } from "../../clients/admin.js";

export type AgentMode = "normal" | "plan";

export interface AgentRuntimeContext {
  [key: string]: unknown;
  runId: string;
  userId: string;
  conversationId: string;
  profileId: AgentMode;
  runtimeKind: "tool-loop";
}

export interface ChatAgentInput {
  runId: string;
  userId: string;
  orgId: string;
  conversationId: string;
  mode: AgentMode;
  provider: ChatProvider;
  imageProvider?: ProviderSnapshot | null;
  videoProviderId?: string | null;
  modelMessages: ModelMessage[];
  instructions: string;
}
