import type { ToolSet } from "@ai-sdk/provider-utils";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

import type { AgentMode } from "../agents/types.js";
import type { ProviderSnapshot } from "../../clients/admin.js";
import { createArtifactTools } from "./builtins/artifact.js";
import { createInteractionTools } from "./builtins/interaction.js";
import { createKnowledgeTools } from "./builtins/files.js";
import { createKnowledgeSearchTools } from "./builtins/knowledge-search.js";
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
// closures so no tool re-fetches a provider. image/video tools are still only
// mounted when the agent has configured that capability — an unconfigured
// capability is not a capability, so it should not appear in either mode.
export interface AgentToolProviders {
  textProvider: ChatProvider;
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
}

// Read-only + planning-neutral builtins: safe to actually run in either mode.
function sharedTools(mode: AgentMode) {
  return {
    ...createKnowledgeTools(),
    ...createKnowledgeSearchTools(),
    ...createWebTools(),
    ...createInteractionTools(mode),
    ...createTodoTools(),
  };
}

// Side-effecting builtins: they generate/persist media, write artifacts, or
// stage memory candidates. Assembled identically for both modes so the model
// always sees the SAME full capability set — the tool schema IS the capability
// declaration the model reasons from — and can produce a precise plan. Plan
// mode keeps these visible but gates execution (see denyExecutionInPlan).
function sideEffectingTools(providers: AgentToolProviders) {
  return {
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
  };
}

// In plan mode the model is given the full tool set so it can reason about the
// complete capability surface, but plan mode must not perform side effects. We
// keep each tool's description/inputSchema/contextSchema (what the model reads)
// and only swap execute for an inert no-op that tells the model to record the
// step in the plan instead of running it now. Mirrors Claude Code's plan mode:
// tools are visible, execution is gated until you switch to execute mode.
const PLAN_MODE_NOTICE = {
  ok: false,
  status: "plan_mode",
  message:
    "plan 阶段不执行该操作。把它作为一个步骤写入计划(## 任务),切换到执行模式后再运行。",
} as const;

function denyExecutionInPlan<T extends ToolSet>(tools: T): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      { ...definition, execute: async () => PLAN_MODE_NOTICE },
    ]),
  ) as unknown as T;
}

function builtinTools(mode: AgentMode, providers: AgentToolProviders) {
  const sideEffecting = sideEffectingTools(providers);
  if (mode === "plan") {
    return {
      ...sharedTools(mode),
      ...createPlanTools(),
      ...denyExecutionInPlan(sideEffecting),
    };
  }
  return {
    ...sharedTools(mode),
    ...sideEffecting,
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
