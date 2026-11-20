import type { InstructionContributions } from "@repo/agent-runtime/instructions/index";
import { PluginManager } from "@repo/agent-runtime/plugins/manager";
import type {
  AgentPluginContext,
  AgentPluginManifest,
  ResolvedPluginSkillContribution,
  ResolvedPluginSet,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import type { ExecutionEnvironment } from "@repo/agent-runtime/runtime/environment";
import type {
  ApprovalPolicy,
  BuiltInPermissionProfileId,
  PermissionProfile,
} from "@repo/agent-runtime/runtime/permissions";
import type { ProcessManager } from "@repo/agent-runtime/runtime/process-manager";
import type { ToolOrchestrator } from "@repo/agent-runtime/runtime/tool-orchestrator";
import { deferAgentToolLoading, manifestsToTools } from "@repo/agent-runtime/tools/manifest";
import { createPortableToolRegistry } from "@repo/agent-runtime/tools/registry";
import type { SkillSource } from "@repo/agent-runtime/tools/skills";
import type { AgentToolManifest } from "@repo/agent-runtime/tools/types";
import type { ToolSet } from "ai";

import type { LanguageProviderSnapshot } from "#runtime/provider-model";

import { createCloudToolAdapters } from "../adapters/cloud-tools.js";
import { createRuntimePortableToolModel } from "../adapters/core-tools.js";
import { RuntimePluginSkillAssetLoader } from "../adapters/plugin-skills.js";
import { webSearch } from "../adapters/web-search.js";
import { createMediaToolManifests } from "./builtins/media.js";
import { createMemoryToolManifests } from "./builtins/memory.js";

export interface AgentToolProviders {
  textProvider: LanguageProviderSnapshot;
}

export interface TurnPluginLoader {
  load(snapshot: ResolvedTurnPluginSnapshot, context: AgentPluginContext): Promise<ResolvedPluginSet>;
}

export interface PluginSkillAssetLoader {
  loadBody(skill: ResolvedPluginSkillContribution, context: AgentPluginContext): Promise<string>;
}

function domainManifests(providers: AgentToolProviders): AgentToolManifest[] {
  return [...createMediaToolManifests(), ...createMemoryToolManifests()].map(deferAgentToolLoading);
}

/** Runtime-owned assembly of core tools plus an already authorized Turn plugin snapshot. */
export class ToolCatalog {
  readonly #plugins: TurnPluginLoader;
  readonly #pluginSkills: PluginSkillAssetLoader;

  constructor(
    plugins: TurnPluginLoader = new PluginManager(),
    pluginSkills: PluginSkillAssetLoader = new RuntimePluginSkillAssetLoader(),
  ) {
    this.#plugins = plugins;
    this.#pluginSkills = pluginSkills;
  }

  async resolve(
    context: AgentPluginContext,
    providers: AgentToolProviders,
    pluginSnapshot: ResolvedTurnPluginSnapshot,
    skillSource?: SkillSource | null,
    executionPolicy: { approvalPolicy: ApprovalPolicy; permissionProfile: BuiltInPermissionProfileId } = {
      approvalPolicy: "on-request",
      permissionProfile: ":workspace",
    },
  ): Promise<{
    tools: ToolSet;
    activeTools: string[];
    codeModeTools: string[];
    manifests: AgentToolManifest[];
    activePlugins: AgentPluginManifest[];
    contributions: InstructionContributions;
    environment: ExecutionEnvironment;
    permissionProfile: PermissionProfile;
    processManager: ProcessManager<{ terminate(): void }>;
    toolApproval: ToolOrchestrator["toolApproval"];
    dispose: () => Promise<void>;
  }> {
    const cloudAdapters = await createCloudToolAdapters(executionPolicy);
    const disposers: Array<() => void | Promise<void>> = [cloudAdapters.dispose];
    try {
      const pluginSet = await this.#plugins.load(pluginSnapshot, context);
      disposers.push(pluginSet.dispose);
      const pluginSkillSource: SkillSource = {
        activeSkillName: skillSource?.activeSkillName,
        skills: pluginSet.skills.map((skill) => ({
          id: `${skill.pluginId}/${skill.id}`,
          name: skill.name,
          description: skill.description,
          loadBody: () => this.#pluginSkills.loadBody(skill, context),
        })),
      };
      const portableTools = createPortableToolRegistry({
        model: createRuntimePortableToolModel(providers.textProvider),
        webSearch,
        skillSource: {
          activeSkillName: skillSource?.activeSkillName,
          skills: [...(skillSource?.skills ?? []), ...pluginSkillSource.skills],
        },
      });

      const additions = [...domainManifests(providers), ...cloudAdapters.manifests];
      for (const manifest of pluginSet.manifests) {
        if (manifest.policy.source !== "mcp") {
          throw new Error(`agent plugin ${manifest.policy.pluginId ?? "unknown"} contributed a non-MCP tool`);
        }
        additions.push(deferAgentToolLoading(manifest));
      }

      const manifests = [...portableTools.manifests, ...additions];
      const activeManifests = manifests.filter((manifest) => manifest.tool);
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
        activePlugins: pluginSet.activePlugins,
        contributions: { skills: [...portableTools.skills] },
        environment: cloudAdapters.environment,
        permissionProfile: cloudAdapters.permissionProfile,
        processManager: cloudAdapters.processManager,
        toolApproval: cloudAdapters.toolApproval,
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
