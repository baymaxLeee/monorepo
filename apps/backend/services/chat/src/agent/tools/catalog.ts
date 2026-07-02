import type { ToolSet } from "@ai-sdk/provider-utils";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

import type { AgentMode } from "../agents/types.js";
import type { ProviderSnapshot } from "../../clients/admin.js";
import { createArtifactTools } from "./builtins/artifact.js";
import { createInteractionTools } from "./builtins/interaction.js";
import { createKnowledgeTools } from "./builtins/files.js";
import { createMediaTools } from "./builtins/media.js";
import { createMemoryTools } from "./builtins/memory.js";
import { createPlanTools } from "./builtins/plan.js";
import { createTodoTools } from "./builtins/todo.js";
import { createVideoTools } from "./builtins/video.js";
import type {
  AgentExtension,
  AgentExtensionContext,
} from "../integrations/types.js";
import { createWebTools } from "./builtins/web.js";

// The agent's resolved providers for a run, injected into tool factories as
// closures so no tool re-fetches a provider. image/video tools are only mounted
// when the agent has configured that capability.
export interface AgentToolProviders {
  textProvider: ChatProvider;
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
}

function builtinTools(mode: AgentMode, providers: AgentToolProviders) {
  if (mode === "plan") {
    return {
      ...createKnowledgeTools(),
      ...createWebTools(),
      ...createInteractionTools(mode),
      ...createPlanTools(),
      ...createTodoTools(),
    };
  }
  return {
    ...createKnowledgeTools(),
    ...createWebTools(),
    ...createInteractionTools(mode),
    ...createMemoryTools(),
    ...createArtifactTools(providers.textProvider),
    ...(providers.imageProvider ? createMediaTools(providers.imageProvider) : {}),
    ...(providers.videoProviderId
      ? createVideoTools({
          videoProviderId: providers.videoProviderId,
          textProviderId: providers.textProvider.id,
          imageProviderId: providers.imageProvider?.id ?? null,
        })
      : {}),
    ...createTodoTools(),
  };
}

export class ToolCatalog {
  readonly #extensions: AgentExtension[] = [];

  register(extension: AgentExtension): () => void {
    if (this.#extensions.some((candidate) => candidate.id === extension.id)) {
      throw new Error(`agent extension ${extension.id} is already registered`);
    }
    this.#extensions.push(extension);
    return () => {
      const index = this.#extensions.indexOf(extension);
      if (index >= 0) this.#extensions.splice(index, 1);
    };
  }

  async resolve(context: AgentExtensionContext, providers: AgentToolProviders): Promise<{
    tools: ReturnType<typeof builtinTools> & ToolSet;
    instructions: string[];
    dispose: () => Promise<void>;
  }> {
    const tools = builtinTools(context.mode, providers) as ReturnType<typeof builtinTools> & ToolSet;
    const instructions: string[] = [];
    const disposers: Array<() => void | Promise<void>> = [];

    for (const extension of this.#extensions) {
      const contribution = await extension.resolve(context);
      for (const [name, definition] of Object.entries(contribution.tools ?? {})) {
        if (tools[name]) {
          throw new Error(`agent tool ${name} from ${extension.id} conflicts with an existing tool`);
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
}

export const defaultToolCatalog = new ToolCatalog();
