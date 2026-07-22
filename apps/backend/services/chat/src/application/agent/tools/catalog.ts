import type { ToolSet } from "ai";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

import type { ProviderSnapshot } from "../../../infrastructure/clients/admin.js";
import type { InstructionContributions } from "../context/instructions/index.js";
import type { AgentMode } from "../agents/types.js";
import type {
  AgentExtension,
  AgentExtensionContext,
} from "../integrations/types.js";
import { createFileToolManifests } from "./builtins/files.js";
import { createInteractionToolManifests } from "./builtins/interaction.js";
import { createMediaToolManifests } from "./builtins/media.js";
import { createMemoryToolManifests } from "./builtins/memory.js";
import { createPlanningToolManifests } from "./builtins/planning.js";
import { createSearchToolManifests } from "./builtins/search.js";
import { type AdminSkillSource, resolveSkills } from "../integrations/skills/provider.js";
import {
  defineAgentTool,
  manifestsToTools,
  renderExecutionCapabilities,
} from "./manifest.js";
import type { AgentToolManifest, ToolSource } from "./types.js";

export interface AgentToolProviders {
  textProvider: ChatProvider;
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
}

function builtinManifests(mode: AgentMode, providers: AgentToolProviders): AgentToolManifest[] {
  return [
    ...createSearchToolManifests(),
    ...createFileToolManifests(mode, providers.textProvider),
    ...createPlanningToolManifests(),
    ...createInteractionToolManifests(mode),
    ...createMediaToolManifests({
      imageProvider: providers.imageProvider,
      videoProviderId: providers.videoProviderId,
    }),
    ...createMemoryToolManifests(),
  ];
}

function extensionSource(id: string): ToolSource {
  if (id.startsWith("mcp:")) return "mcp";
  if (id.startsWith("skill:")) return "skill";
  return "skill";
}

function safeNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function extensionToolName(extensionId: string, toolName: string): string {
  if (extensionId.startsWith("mcp:")) {
    return `mcp__${safeNamespace(extensionId.slice(4))}__${safeNamespace(toolName)}`;
  }
  if (extensionId.startsWith("skill:")) {
    return `skill__${safeNamespace(extensionId.slice(6))}__${safeNamespace(toolName)}`;
  }
  return safeNamespace(toolName);
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

  async resolve(
    context: AgentExtensionContext,
    providers: AgentToolProviders,
    skillSource?: AdminSkillSource | null,
  ): Promise<{
    tools: ToolSet;
    activeTools: string[];
    manifests: AgentToolManifest[];
    contributions: InstructionContributions;
    dispose: () => Promise<void>;
  }> {
    const resolvedSkills = resolveSkills(skillSource);
    const manifests = [...builtinManifests(context.mode, providers), ...resolvedSkills.manifests];
    const skills = [...resolvedSkills.skills];
    const disposers: Array<() => void | Promise<void>> = [];

    for (const extension of [...this.#extensions]) {
      const contribution = await extension.resolve(context);
      const source = extensionSource(extension.id);
      for (const [contributedName, definition] of Object.entries(contribution.tools ?? {})) {
        const name = extensionToolName(extension.id, contributedName);
        manifests.push(
          defineAgentTool(
            name,
            definition,
            {
              capability: "external",
              effect: "unknown",
              trust: "unknown",
              execution: "inline",
              modes: ["normal"],
              source,
            },
            {
              summary:
                typeof definition.description === "string"
                  ? definition.description
                  : `Use ${name} from ${extension.id}.`,
              prerequisites: [`Enable and authorize ${extension.id}.`],
            },
          ),
        );
      }
      if (contribution.dispose) disposers.push(contribution.dispose);
    }

    const names = new Set<string>();
    for (const manifest of manifests) {
      if (names.has(manifest.name)) throw new Error(`duplicate agent tool ${manifest.name}`);
      names.add(manifest.name);
    }

    // Capability projection is code-generated from resolved manifests and only
    // in plan mode; normal mode relies on the callable tool schemas directly.
    const capabilities =
      context.mode === "plan" ? renderExecutionCapabilities(manifests) || null : null;

    const activeManifests = manifests.filter(
      (manifest) => manifest.tool && manifest.policy.modes.includes(context.mode),
    );
    const tools = manifestsToTools(activeManifests);
    const activeTools = Object.keys(tools);

    return {
      tools,
      activeTools,
      manifests,
      contributions: { capabilities, skills },
      dispose: async () => {
        await Promise.allSettled(disposers.reverse().map((dispose) => dispose()));
      },
    };
  }
}
