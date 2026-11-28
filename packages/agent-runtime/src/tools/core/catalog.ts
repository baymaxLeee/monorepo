import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FlexibleSchema } from "ai";

import type { ModelContextLimits } from "../../context/budget.js";
import { createSubagentTurnRunner, DEFAULT_SUBAGENT_INSTRUCTIONS } from "../delegation/subagent-turn.js";
import { createSubagentsManifest, type SubagentObserver } from "../delegation/subagents.js";
import { createPlanningToolManifests } from "../interaction/plan.js";
import { createUIAgentToolManifests } from "../interaction/ui-agent.js";
import { createCodeModeManifest } from "../research/code-mode.js";
import {
  createWebFetchManifest,
  createWebSearchManifest,
  type WebSearchInput,
  type WebSearchOutput,
} from "../research/web.js";
import { resolveSkills, type SkillSource } from "../skills/loader.js";
import { manifestsToTools, withToolExposure } from "./manifest.js";
import { AgentToolRegistry } from "./registry.js";
import type { ToolRoutingMode } from "./registry.js";
import type { AgentToolManifest } from "./types.js";

export interface PortableToolModel<CONTEXT extends Record<string, unknown>> {
  name: string;
  model: LanguageModelV4;
  contextLimits: ModelContextLimits;
  contextSchema?: FlexibleSchema<CONTEXT>;
  observer?: SubagentObserver<CONTEXT>;
}

export interface PortableToolBindings<CONTEXT extends Record<string, unknown>> {
  model: PortableToolModel<CONTEXT>;
  webSearch(input: WebSearchInput, options: { abortSignal?: AbortSignal }): Promise<WebSearchOutput>;
  skillSource?: SkillSource | null;
  uiAgent?: boolean;
}

/**
 * Creates the portable tool registry and binds its execution ports. Hosts append
 * only the manifests backed by their own execution environment or domain.
 */
export function createPortableToolRegistry<CONTEXT extends Record<string, unknown> = Record<string, never>>({
  model,
  webSearch,
  skillSource,
  uiAgent = false,
}: PortableToolBindings<CONTEXT>) {
  const webSearchManifest = createWebSearchManifest(webSearch);
  const webFetchManifest = createWebFetchManifest();
  const researchTools = manifestsToTools([webSearchManifest, webFetchManifest]);
  const skills = resolveSkills(skillSource);

  if (!researchTools.web_search || !researchTools.web_fetch) {
    throw new Error("portable research tools are unavailable");
  }
  const subagentRunner = createSubagentTurnRunner({
    modelName: model.name,
    model: model.model,
    instructions: DEFAULT_SUBAGENT_INSTRUCTIONS,
    contextLimits: model.contextLimits,
    maxOutputTokens: model.contextLimits.maxOutputTokens,
    tools: {
      web_search: researchTools.web_search,
      web_fetch: researchTools.web_fetch,
    },
    toolsContext: {},
  });

  return {
    manifests: [
      webSearchManifest,
      webFetchManifest,
      createCodeModeManifest(),
      ...createPlanningToolManifests(),
      ...(uiAgent ? createUIAgentToolManifests() : []),
      createSubagentsManifest({
        runner: subagentRunner,
        ...(model.contextSchema ? { contextSchema: model.contextSchema } : {}),
        ...(model.observer ? { observer: model.observer } : {}),
      }),
      ...skills.manifests,
    ],
    skills: skills.skills,
  };
}

/** Freeze one host's declarations into the settings consumed by the SDK loop. */
export function buildAgentToolRouter(
  builtins: AgentToolManifest[],
  plugins: AgentToolManifest[],
  options: { mode?: ToolRoutingMode; loadedTools?: readonly string[] } = {},
) {
  const registry = new AgentToolRegistry();
  registry.registerAll(builtins);
  for (const plugin of plugins) {
    if (plugin.policy.source !== "mcp") {
      throw new Error(`agent plugin ${plugin.policy.pluginId ?? "unknown"} contributed a non-MCP tool`);
    }
    registry.register(withToolExposure(plugin, "deferred"));
  }
  return registry.finalize(options);
}
