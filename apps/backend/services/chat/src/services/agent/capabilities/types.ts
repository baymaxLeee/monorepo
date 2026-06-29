import type { ToolSet } from "@ai-sdk/provider-utils";

import type { AgentMode } from "../contract.js";

export interface CapabilityResolutionContext {
  mode: AgentMode;
  runId: string;
  userId: string;
  conversationId: string;
}

export interface CapabilityContribution {
  tools?: ToolSet;
  instructions?: string[];
  dispose?: () => void | Promise<void>;
}

export interface CapabilityProvider {
  id: string;
  resolve(
    context: CapabilityResolutionContext,
  ): CapabilityContribution | Promise<CapabilityContribution>;
}

