import type { ToolSet } from "@ai-sdk/provider-utils";

import type { AgentMode } from "../agents/types.js";

export interface AgentExtensionContext {
  mode: AgentMode;
  runId: string;
  userId: string;
  conversationId: string;
}

export interface AgentExtensionContribution {
  tools?: ToolSet;
  dispose?: () => void | Promise<void>;
}

export interface AgentExtension {
  id: string;
  resolve(context: AgentExtensionContext): AgentExtensionContribution | Promise<AgentExtensionContribution>;
}
