import { DIRECT_TOOL_CALL } from "@ai-sdk/code-mode";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FlexibleSchema } from "ai";

import type { StoredModelContinuation } from "../turn/model-capabilities.js";
import { createInteractionToolManifests } from "./ask-user.js";
import { createCodeModeManifest } from "./code-mode.js";
import { deferAgentToolLoading, manifestsToTools } from "./manifest.js";
import { createPlanningToolManifests } from "./plan.js";
import { resolveSkills, type SkillSource } from "./skills.js";
import { createSubagentsManifest, type SubagentObserver } from "./subagents.js";
import { createToolSearchManifest } from "./tool-search.js";
import type { AgentToolManifest } from "./types.js";
import { createUIAgentToolManifests } from "./ui-agent.js";
import { createWebFetchManifest, createWebSearchManifest, type WebSearchInput, type WebSearchOutput } from "./web.js";

export interface PortableToolModel<CONTEXT extends Record<string, unknown>> {
  name: string;
  model: LanguageModelV4;
  maxOutputTokens?: number;
  continuation?: StoredModelContinuation;
  contextSchema?: FlexibleSchema<CONTEXT>;
  observer?: SubagentObserver<CONTEXT>;
}

export interface PortableToolBindings<CONTEXT extends Record<string, unknown>> {
  model: PortableToolModel<CONTEXT>;
  webSearch(input: WebSearchInput, options: { abortSignal?: AbortSignal }): Promise<WebSearchOutput>;
  skillSource?: SkillSource | null;
  clientInteraction?: boolean;
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
  clientInteraction = true,
  uiAgent = false,
}: PortableToolBindings<CONTEXT>) {
  const webSearchManifest = createWebSearchManifest(webSearch);
  const webFetchManifest = createWebFetchManifest();
  const researchTools = manifestsToTools([webSearchManifest, webFetchManifest]);
  const skills = resolveSkills(skillSource);

  if (!researchTools.web_search || !researchTools.web_fetch) {
    throw new Error("portable research tools are unavailable");
  }

  return {
    manifests: [
      webSearchManifest,
      webFetchManifest,
      deferAgentToolLoading(createCodeModeManifest()),
      createToolSearchManifest(),
      ...createPlanningToolManifests(),
      ...(clientInteraction ? createInteractionToolManifests() : []),
      ...(uiAgent ? createUIAgentToolManifests() : []),
      deferAgentToolLoading(
        createSubagentsManifest({
          modelName: model.name,
          model: model.model,
          maxOutputTokens: model.maxOutputTokens,
          continuation: model.continuation,
          tools: {
            web_search: researchTools.web_search,
            web_fetch: researchTools.web_fetch,
          },
          ...(model.contextSchema ? { contextSchema: model.contextSchema } : {}),
          ...(model.observer ? { observer: model.observer } : {}),
        }),
      ),
      ...skills.manifests,
    ],
    skills: skills.skills,
  };
}

/** Freeze one host's declarations into the settings consumed by the SDK loop. */
export function compileTurnTools(builtins: AgentToolManifest[], plugins: AgentToolManifest[]) {
  const manifests = [...builtins];
  for (const plugin of plugins) {
    if (plugin.policy.source !== "mcp") {
      throw new Error(`agent plugin ${plugin.policy.pluginId ?? "unknown"} contributed a non-MCP tool`);
    }
    manifests.push(deferAgentToolLoading(plugin));
  }
  const tools = manifestsToTools(manifests);
  const toolCallers: Record<string, (string | typeof DIRECT_TOOL_CALL)[]> = {};
  for (const { name, tool, policy } of manifests) {
    if (!tool || !policy.callableByCodeMode) continue;
    if (policy.effect !== "read" || policy.execution !== "inline" || policy.trust !== "open-world") {
      throw new Error(`Code Mode tool ${name} must be an inline, open-world read`);
    }
    toolCallers[name] = ["code_mode", DIRECT_TOOL_CALL];
  }
  return {
    manifests,
    tools,
    activeTools: Object.keys(tools),
    toolSources: new Map(manifests.map(({ name, policy }) => [name, policy.source])),
    toolCallers,
  };
}
