import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import type { InstructionContributions } from "@repo/agent-runtime/instructions/index";
import { defineAgentTool, manifestsToTools, renderExecutionCapabilities } from "@repo/agent-runtime/manifest";
import type { AgentToolManifest, ToolSource } from "@repo/agent-runtime/tool-types";
import { createCoreToolManifests } from "@repo/agent-runtime/tools/core";
import type { AdminSkillSource } from "@repo/agent-runtime/tools/skills";
import type { ToolSet } from "ai";

import type { ProviderSnapshot } from "../../../infrastructure/clients/admin.js";
import { createCloudToolAdapters } from "../adapters/cloud-tools.js";
import { createRuntimeCoreToolModel } from "../adapters/core-tools.js";
import { webSearch } from "../adapters/web-search.js";
import type { AgentExtension, AgentExtensionContext } from "../integrations/types.js";
import { createCanvasToolManifests } from "./builtins/canvas.js";
import { createKnowledgeToolManifests } from "./builtins/knowledge.js";
import { createMediaToolManifests } from "./builtins/media.js";
import { createMemoryToolManifests } from "./builtins/memory.js";

export interface AgentToolProviders {
  textProvider: LanguageProviderSnapshot;
  imageProvider: ProviderSnapshot | null;
  videoProviderId: string | null;
}

function domainManifests(providers: AgentToolProviders): AgentToolManifest[] {
  return [
    ...createKnowledgeToolManifests(),
    ...createMediaToolManifests({
      imageProvider: providers.imageProvider,
      videoProviderId: providers.videoProviderId,
    }),
    ...createMemoryToolManifests(),
  ];
}

function extensionSource(id: string): ToolSource {
  if (id.startsWith("mcp:")) {
    return "mcp";
  }
  if (id.startsWith("skill:")) {
    return "skill";
  }
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
      if (index >= 0) {
        this.#extensions.splice(index, 1);
      }
    };
  }

  async resolve(
    context: AgentExtensionContext,
    providers: AgentToolProviders,
    skillSource?: AdminSkillSource | null,
  ): Promise<{
    tools: ToolSet;
    activeTools: string[];
    codeModeTools: string[];
    manifests: AgentToolManifest[];
    contributions: InstructionContributions;
    dispose: () => Promise<void>;
  }> {
    const core = createCoreToolManifests({
      mode: context.mode,
      model: createRuntimeCoreToolModel(providers.textProvider),
      webSearch,
      skillSource,
    });
    const cloudAdapters = await createCloudToolAdapters();
    const disposers: Array<() => void | Promise<void>> = [cloudAdapters.dispose];
    try {
      const manifests = [
        ...core.manifests,
        ...domainManifests(providers),
        ...cloudAdapters.manifests,
        ...(context.projectId && context.canvasId
          ? createCanvasToolManifests({
              textProviderId: providers.textProvider.id,
              videoProviderId: providers.videoProviderId,
            })
          : []),
      ];
      const skills = [...core.skills];

      for (const extension of [...this.#extensions]) {
        const contribution = await extension.resolve(context);
        if (contribution.dispose) {
          disposers.push(contribution.dispose);
        }
        const source = extensionSource(extension.id);
        for (const [contributedName, definition] of Object.entries(contribution.tools ?? {})) {
          const name = extensionToolName(extension.id, contributedName);
          manifests.push(
            defineAgentTool(
              name,
              { ...definition, deferLoading: true },
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
      }

      const names = new Set<string>();
      for (const manifest of manifests) {
        if (names.has(manifest.name)) {
          throw new Error(`duplicate agent tool ${manifest.name}`);
        }
        names.add(manifest.name);
      }

      // Capability projection is code-generated from resolved manifests and only
      // in plan mode; normal mode relies on the callable tool schemas directly.
      const capabilities = context.mode === "plan" ? renderExecutionCapabilities(manifests) || null : null;

      const activeManifests = manifests.filter(
        (manifest) => manifest.tool && manifest.policy.modes.includes(context.mode),
      );
      const tools = manifestsToTools(activeManifests);
      const activeTools = Object.keys(tools);
      const codeModeManifests = activeManifests.filter((manifest) => manifest.policy.callableByCodeMode);
      for (const manifest of codeModeManifests) {
        if (
          manifest.policy.effect !== "read" ||
          manifest.policy.execution !== "inline" ||
          manifest.policy.trust !== "open-world"
        ) {
          throw new Error(`Code Mode tool ${manifest.name} must be an inline, open-world read`);
        }
      }
      const codeModeTools = codeModeManifests.map((manifest) => manifest.name);

      return {
        tools,
        activeTools,
        codeModeTools,
        manifests,
        contributions: { capabilities, skills },
        dispose: async () => {
          await Promise.allSettled(disposers.reverse().map((dispose) => dispose()));
        },
      };
    } catch (error) {
      await Promise.allSettled(disposers.reverse().map((dispose) => dispose()));
      throw error;
    }
  }
}
