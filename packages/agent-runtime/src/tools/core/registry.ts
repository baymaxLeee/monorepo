import { DIRECT_TOOL_CALL } from "@ai-sdk/code-mode";
import type { ToolSet } from "ai";

import { createToolSearchManifest } from "../discovery/tool-search.js";
import { createInteractionToolManifests } from "../interaction/ask-user.js";
import { manifestsToTools, transformToolPreservingCaller } from "./manifest.js";
import type { AgentToolManifest, ToolExposure } from "./types.js";

export type ToolRoutingMode = "direct" | "code-mode" | "code-mode-only";

const DIRECT_EXPOSURES = new Set<ToolExposure>(["direct", "direct-model-only"]);
const DEFERRED_EXPOSURES = new Set<ToolExposure>(["deferred", "deferred-model-only"]);
const CODE_MODE_EXPOSURES = new Set<ToolExposure>(["direct", "deferred", "code-mode-only"]);

function exposeDefinition(manifest: AgentToolManifest): AgentToolManifest {
  if (!manifest.tool || !DEFERRED_EXPOSURES.has(manifest.exposure)) return manifest;
  return {
    ...manifest,
    tool: transformToolPreservingCaller(manifest.tool, (definition) => ({ ...definition, deferLoading: true })),
  };
}

function directCaller(exposure: ToolExposure): boolean {
  return DIRECT_EXPOSURES.has(exposure) || DEFERRED_EXPOSURES.has(exposure);
}

/** Mutable registration phase. Finalization consumes a snapshot so hosts cannot
 * change the catalog after a Turn starts. */
export class AgentToolRegistry {
  readonly #entries = new Map<string, AgentToolManifest>();

  constructor() {
    this.registerAll(createInteractionToolManifests());
  }

  register(manifest: AgentToolManifest): void {
    if (this.#entries.has(manifest.name)) throw new Error(`duplicate agent tool ${manifest.name}`);
    this.#entries.set(manifest.name, manifest);
  }

  registerAll(manifests: readonly AgentToolManifest[]): void {
    for (const manifest of manifests) this.register(manifest);
  }

  finalize(options: { mode?: ToolRoutingMode; loadedTools?: readonly string[] } = {}): AgentToolRouter {
    return new AgentToolRouter([...this.#entries.values()], options);
  }
}

function exposureForMode(manifest: AgentToolManifest, mode: ToolRoutingMode): ToolExposure {
  if (mode !== "code-mode-only") return manifest.exposure;
  if (manifest.exposure === "direct") {
    return manifest.policy.callableByCodeMode ? "code-mode-only" : "direct-model-only";
  }
  return manifest.exposure;
}

/** Immutable execution and model-exposure plan for one Turn. */
export class AgentToolRouter {
  readonly manifests: AgentToolManifest[];
  readonly tools: ToolSet;
  readonly activeTools: string[];
  readonly toolOrder: string[];
  readonly toolSources: Map<string, AgentToolManifest["policy"]["source"]>;
  readonly toolCallers: Record<string, (string | typeof DIRECT_TOOL_CALL)[]>;

  constructor(
    input: readonly AgentToolManifest[],
    options: { mode?: ToolRoutingMode; loadedTools?: readonly string[] } = {},
  ) {
    const mode = options.mode ?? "code-mode";
    const loadedOrder = [...new Set(options.loadedTools ?? [])];
    const loaded = new Set(loadedOrder);
    const available = input
      .filter((manifest) => manifest.tool && manifest.availability === "available")
      .map((manifest) => {
        const exposure = exposureForMode(manifest, mode);
        if (!loaded.has(manifest.name)) return { ...manifest, exposure };
        if (exposure === "deferred") return { ...manifest, exposure: "direct" as const };
        if (exposure === "deferred-model-only") return { ...manifest, exposure: "direct-model-only" as const };
        return { ...manifest, exposure };
      });
    const searchable = available.filter((manifest) => DEFERRED_EXPOSURES.has(manifest.exposure));
    const withoutSearch = available.filter((manifest) => manifest.name !== "tool_search");
    const withSearch = [...withoutSearch, createToolSearchManifest(searchable)];
    this.manifests = withSearch.map(exposeDefinition);
    this.tools = manifestsToTools(this.manifests);
    this.activeTools = this.manifests.filter(({ exposure }) => exposure !== "hidden").map(({ name }) => name);
    const loadedActive = loadedOrder.filter((name) => this.activeTools.includes(name));
    this.toolOrder = [...this.activeTools.filter((name) => !loaded.has(name)), ...loadedActive];
    this.toolSources = new Map(this.manifests.map(({ name, policy }) => [name, policy.source]));
    this.toolCallers = {};
    for (const { name, exposure, policy } of this.manifests) {
      if (
        policy.callableByCodeMode &&
        (policy.effect !== "read" || policy.execution !== "inline" || policy.trust !== "open-world")
      ) {
        throw new Error(`Code Mode tool ${name} must be an inline, open-world read`);
      }
      const callers: (string | typeof DIRECT_TOOL_CALL)[] = [];
      if (directCaller(exposure)) callers.push(DIRECT_TOOL_CALL);
      if (policy.callableByCodeMode && CODE_MODE_EXPOSURES.has(exposure)) callers.unshift("code_mode");
      if (callers.length > 0 && !(callers.length === 1 && callers[0] === DIRECT_TOOL_CALL)) {
        this.toolCallers[name] = callers;
      }
    }
  }
}
