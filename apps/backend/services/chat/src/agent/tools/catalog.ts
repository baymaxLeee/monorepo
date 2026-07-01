import type { ToolSet } from "@ai-sdk/provider-utils";

import type { AgentMode } from "../agents/types.js";
import { createArtifactTools } from "./builtins/artifact.js";
import { createInteractionTools } from "./builtins/interaction.js";
import { createKnowledgeTools } from "./builtins/files.js";
import { createMemoryTools } from "./builtins/memory.js";
import { createPlanTools } from "./builtins/plan.js";
import { createTodoTools } from "./builtins/todo.js";
import type {
  AgentExtension,
  AgentExtensionContext,
} from "../integrations/types.js";
import { createWebTools } from "./builtins/web.js";

function builtinTools(mode: AgentMode) {
  return mode === "plan"
    ? {
        ...createKnowledgeTools(),
        ...createWebTools(),
        ...createInteractionTools(mode),
        ...createPlanTools(),
        ...createTodoTools(),
      }
    : {
        ...createKnowledgeTools(),
        ...createWebTools(),
        ...createInteractionTools(mode),
        ...createMemoryTools(),
        ...createArtifactTools(),
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

  async resolve(context: AgentExtensionContext): Promise<{
    tools: ReturnType<typeof builtinTools> & ToolSet;
    instructions: string[];
    dispose: () => Promise<void>;
  }> {
    const tools = builtinTools(context.mode) as ReturnType<typeof builtinTools> & ToolSet;
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
