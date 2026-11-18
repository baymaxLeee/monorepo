import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FlexibleSchema } from "ai";

import { createCodeModeManifest } from "./code-mode.js";
import { createToolSearchManifest } from "./discovery.js";
import { createInteractionToolManifests } from "./interaction.js";
import { manifestsToTools } from "./manifest.js";
import { createPlanningToolManifests } from "./planning.js";
import { type AdminSkillSource, resolveSkills } from "./skills.js";
import { createSubagentsManifest, type SubagentObserver } from "./subagents.js";
import { createWebFetchManifest, createWebSearchManifest, type WebSearchInput, type WebSearchOutput } from "./web.js";

export interface PortableToolModel<CONTEXT extends Record<string, unknown>> {
  name: string;
  model: LanguageModelV4;
  maxOutputTokens?: number;
  supportsStoredContinuation: boolean;
  contextSchema?: FlexibleSchema<CONTEXT>;
  observer?: SubagentObserver<CONTEXT>;
}

export interface PortableToolBindings<CONTEXT extends Record<string, unknown>> {
  model: PortableToolModel<CONTEXT>;
  webSearch(input: WebSearchInput, options: { abortSignal?: AbortSignal }): Promise<WebSearchOutput>;
  skillSource?: AdminSkillSource | null;
  clientInteraction?: boolean;
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
      createCodeModeManifest(),
      createToolSearchManifest(),
      ...createPlanningToolManifests(),
      ...(clientInteraction ? createInteractionToolManifests() : []),
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
