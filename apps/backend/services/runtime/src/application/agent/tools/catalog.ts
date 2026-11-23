import { createHash } from "node:crypto";

import {
  PluginManager,
  type AgentPluginContext,
  type ResolvedPluginSkillContribution,
  type ResolvedPluginSet,
  type ResolvedTurnPluginSnapshot,
  type SkillSource,
  deferAgentToolLoading,
  createPortableToolRegistry,
  compileTurnTools,
  type AgentToolManifest,
  type ApprovalPolicy,
  type BuiltInPermissionProfileId,
} from "@repo/agent-runtime";
import type { UIMessage } from "ai";

import type { LanguageProviderSnapshot } from "#runtime/provider-model";

import type { MediaCapabilities } from "../../../infrastructure/provider/capability.js";
import { RequestError } from "../../errors.js";
import { createCloudToolAdapters } from "../adapters/cloud-tools.js";
import { createRuntimePortableToolModel } from "../adapters/core-tools.js";
import { RuntimePluginSkillAssetLoader } from "../adapters/plugin-skills.js";
import { webSearch } from "../adapters/web-search.js";
import { createMediaToolManifests } from "./builtins/media.js";

export interface AgentToolProviders {
  textProvider: LanguageProviderSnapshot;
  media: MediaCapabilities;
}

/** Turn-local execution identity; product authorization stays in the upper host. */
export interface HostPluginContext extends AgentPluginContext {
  turnId: string;
  threadId: string;
}

export interface TurnPluginLoader {
  load(snapshot: ResolvedTurnPluginSnapshot, context: AgentPluginContext): Promise<ResolvedPluginSet>;
}

export interface PluginSkillAssetLoader {
  loadBody(skill: ResolvedPluginSkillContribution, context: HostPluginContext): Promise<string>;
}

function catalogDigest(manifests: AgentToolManifest[]): string {
  const projection = manifests
    .map((manifest) => ({
      name: manifest.name,
      availability: manifest.availability,
      policy: manifest.policy,
      planning: manifest.planning,
      description: manifest.tool?.description ?? null,
      deferred: manifest.tool && "deferLoading" in manifest.tool ? manifest.tool.deferLoading === true : false,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

function domainManifests(providers: AgentToolProviders): AgentToolManifest[] {
  if (providers.media.providers.length === 0) return [];
  return createMediaToolManifests().map(deferAgentToolLoading);
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
    context: HostPluginContext,
    providers: AgentToolProviders,
    pluginSnapshot: ResolvedTurnPluginSnapshot,
    skillSource?: SkillSource | null,
    executionPolicy: { approvalPolicy: ApprovalPolicy; permissionProfile: BuiltInPermissionProfileId } = {
      approvalPolicy: "on-request",
      permissionProfile: ":workspace",
    },
    continuation?: UIMessage,
  ) {
    await using acquired = new AsyncDisposableStack();
    const cloudAdapters = await createCloudToolAdapters(executionPolicy, continuation);
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
      [...portableTools.manifests, ...domainManifests(providers), ...cloudAdapters.manifests],
      pluginSet.manifests,
    );
    const resources = acquired.move();
    return {
      ...catalog,
      catalogDigest: catalogDigest(catalog.manifests),
      activatedSkill,
      contributions: { skills: [...portableTools.skills] },
      environment: cloudAdapters.environment,
      permissionProfile: cloudAdapters.permissionProfile,
      processManager: cloudAdapters.processManager,
      toolApproval: cloudAdapters.toolApproval,
      dispose: () => resources.disposeAsync(),
    };
  }
}
