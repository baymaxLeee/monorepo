import type { ToolSet } from "@ai-sdk/provider-utils";

import type { AgentMode } from "../contract.js";
import { createArtifactTools } from "./artifacts/tools.js";
import { createInteractionTools } from "./interaction/tools.js";
import { createKnowledgeTools } from "./knowledge/tools.js";
import { createMemoryTools } from "./memory/tools.js";
import { createPlanTools } from "./plans/tools.js";
import type {
  CapabilityProvider,
  CapabilityResolutionContext,
} from "./types.js";
import { createWebTools } from "./web/tools.js";

const extensionProviders: CapabilityProvider[] = [];

export function registerCapabilityProvider(provider: CapabilityProvider): () => void {
  if (extensionProviders.some((candidate) => candidate.id === provider.id)) {
    throw new Error(`agent capability provider ${provider.id} is already registered`);
  }
  extensionProviders.push(provider);
  return () => {
    const index = extensionProviders.indexOf(provider);
    if (index >= 0) extensionProviders.splice(index, 1);
  };
}

function builtinTools(mode: AgentMode) {
  return mode === "plan"
    ? {
        ...createKnowledgeTools(),
        ...createWebTools(),
        ...createInteractionTools(mode),
        ...createPlanTools(),
      }
    : {
        ...createKnowledgeTools(),
        ...createWebTools(),
        ...createInteractionTools(mode),
        ...createMemoryTools(),
        ...createArtifactTools(),
      };
}

export async function resolveAgentCapabilities(
  context: CapabilityResolutionContext,
): Promise<{
  tools: ReturnType<typeof builtinTools> & ToolSet;
  instructions: string[];
  dispose: () => Promise<void>;
}> {
  const tools = builtinTools(context.mode) as ReturnType<typeof builtinTools> & ToolSet;
  const instructions: string[] = [];
  const disposers: Array<() => void | Promise<void>> = [];

  for (const provider of extensionProviders) {
    const contribution = await provider.resolve(context);
    for (const [name, definition] of Object.entries(contribution.tools ?? {})) {
      if (tools[name]) {
        throw new Error(`agent tool ${name} from ${provider.id} conflicts with an existing tool`);
      }
      tools[name] = definition;
    }
    instructions.push(...(contribution.instructions ?? []));
    if (contribution.dispose) disposers.push(contribution.dispose);
  }

  return {
    tools,
    instructions,
    dispose: async () => {
      await Promise.allSettled(disposers.reverse().map((dispose) => dispose()));
    },
  };
}
