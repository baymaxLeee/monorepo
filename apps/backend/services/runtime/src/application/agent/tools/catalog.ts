import type { ApprovalPolicy, BuiltInPermissionProfileId } from "@repo/agent-runtime/execution/permissions";
import { PluginManager } from "@repo/agent-runtime/plugins/manager";
import type {
  AgentPluginContext,
  ResolvedPluginSkillContribution,
  ResolvedPluginSet,
  ResolvedTurnPluginSnapshot,
} from "@repo/agent-runtime/plugins/types";
import { compileTurnTools } from "@repo/agent-runtime/tools/catalog";
import { deferAgentToolLoading } from "@repo/agent-runtime/tools/manifest";
import { createPortableToolRegistry } from "@repo/agent-runtime/tools/registry";
import type { SkillSource } from "@repo/agent-runtime/tools/skills";
import type { AgentToolManifest } from "@repo/agent-runtime/tools/types";

import type { LanguageProviderSnapshot } from "#runtime/provider-model";

import { RequestError } from "../../errors.js";
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

function domainManifests(): AgentToolManifest[] {
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
  ) {
    await using acquired = new AsyncDisposableStack();
    const cloudAdapters = await createCloudToolAdapters(executionPolicy);
    acquired.defer(cloudAdapters.dispose);
    const pluginSet = await this.#plugins.load(pluginSnapshot, context);
    acquired.defer(pluginSet.dispose);
    const skills = [
      ...(skillSource?.skills ?? []),
      ...pluginSet.skills.map((skill) => ({
        id: `${skill.pluginId}/${skill.id}`,
        name: `${skill.pluginId}:${skill.name}`,
        description: skill.description,
        loadBody: () => this.#pluginSkills.loadBody(skill, context),
      })),
    ];
    const activeSkillName = skillSource?.activeSkillName;
    const portableTools = createPortableToolRegistry({
      model: createRuntimePortableToolModel(providers.textProvider),
      webSearch,
      skillSource: { activeSkillName, skills },
    });
    let activatedSkill = null;
    if (activeSkillName) {
      const skill = skills.find((entry) => entry.name === activeSkillName);
      if (!skill) throw new RequestError(`skill "${activeSkillName}" is unavailable in this turn`);
      const body = await skill.loadBody();
      if (!body.trim()) throw new RequestError(`skill "${activeSkillName}" has no content to load`);
      activatedSkill = { name: activeSkillName, body };
    }

    const catalog = compileTurnTools(
      [...portableTools.manifests, ...domainManifests(), ...cloudAdapters.manifests],
      pluginSet.manifests,
    );
    const resources = acquired.move();
    return {
      ...catalog,
      activatedSkill,
      contributions: { skills: [...portableTools.skills] },
      environment: cloudAdapters.environment,
      toolApproval: cloudAdapters.toolApproval,
      dispose: () => resources.disposeAsync(),
    };
  }
}
