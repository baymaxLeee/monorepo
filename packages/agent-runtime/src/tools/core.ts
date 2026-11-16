import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FlexibleSchema } from "ai";

import { manifestsToTools } from "../manifest.js";
import type { AgentMode } from "../types.js";
import { createCodeModeManifest } from "./code-mode.js";
import { createToolSearchManifest } from "./discovery.js";
import { createInteractionToolManifests } from "./interaction.js";
import { createPlanningToolManifests } from "./planning.js";
import { type AdminSkillSource, resolveSkills } from "./skills.js";
import { createSubagentsManifest, type SubagentObserver } from "./subagents.js";
import { createWebFetchManifest, createWebSearchManifest, type WebSearchInput, type WebSearchOutput } from "./web.js";

export interface CoreToolModel<CONTEXT extends Record<string, unknown>> {
  name: string;
  model: LanguageModelV4;
  maxOutputTokens?: number;
  supportsStoredContinuation: boolean;
  contextSchema?: FlexibleSchema<CONTEXT>;
  observer?: SubagentObserver<CONTEXT>;
}

export interface CoreToolOptions<CONTEXT extends Record<string, unknown>> {
  mode: AgentMode;
  model: CoreToolModel<CONTEXT>;
  webSearch(input: WebSearchInput, options: { abortSignal?: AbortSignal }): Promise<WebSearchOutput>;
  skillSource?: AdminSkillSource | null;
  clientInteraction?: boolean;
}

/**
 * The portable tool surface owned by the shared Agent runtime.
 *
 * Hosts inject execution dependencies and append host/domain manifests; they do
 * not select individual core tools. `clientInteraction: false` is reserved for
 * hosts that cannot yet continue an SDK client tool result.
 */
export function createCoreToolManifests<CONTEXT extends Record<string, unknown> = Record<string, never>>({
  mode,
  model,
  webSearch,
  skillSource,
  clientInteraction = true,
}: CoreToolOptions<CONTEXT>) {
  const webSearchManifest = createWebSearchManifest(webSearch);
  const webFetchManifest = createWebFetchManifest();
  const researchTools = manifestsToTools([webSearchManifest, webFetchManifest]);
  const skills = resolveSkills(skillSource);

  if (!researchTools.web_search || !researchTools.web_fetch) {
    throw new Error("core research tools are unavailable");
  }

  return {
    manifests: [
      webSearchManifest,
      webFetchManifest,
      createCodeModeManifest(),
      createToolSearchManifest(),
      ...createPlanningToolManifests(),
      ...(clientInteraction ? createInteractionToolManifests(mode) : []),
      createSubagentsManifest({
        modelName: model.name,
        model: model.model,
        maxOutputTokens: model.maxOutputTokens,
        supportsStoredContinuation: model.supportsStoredContinuation,
        tools: {
          web_search: researchTools.web_search,
          web_fetch: researchTools.web_fetch,
        },
        ...(model.contextSchema ? { contextSchema: model.contextSchema } : {}),
        ...(model.observer ? { observer: model.observer } : {}),
      }),
      ...skills.manifests,
    ],
    skills: skills.skills,
  };
}
