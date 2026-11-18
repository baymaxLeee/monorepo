import { InnerApiCaller, InnerApiError, insecureChannelCredentials } from "@backend/inner-api/client";
import {
  AgentConfigurationServiceClient,
  type ModelProvider,
  type GetResolvedAgentResponse,
  type GetSkillFileResponse,
  type GetSkillResponse,
  ProviderKind,
  ProviderServiceClient,
  type ResolvedAgent,
} from "@backend/inner-api/gen/admin/v1/admin";
import type { BotProfileSnapshot, BotTone } from "@repo/agent-runtime/instructions/index";

import { propagationHeaders } from "#runtime/foundation";
import type { LanguageProviderSnapshot } from "#runtime/provider-model";
import { assertPublicProviderUrl } from "#runtime/provider-url";

import { AdminUnavailableError, ProviderNotConfiguredError, RequestError } from "../../application/errors.js";
import { getServerSettings } from "../../config/server.js";
import { getRedisClient } from "../redis/index.js";

export interface ProviderSnapshot {
  id: string;
  userId: string;
  name: string;
  model: string;
  providerKind: string;
  baseUrl: string;
  apiKey: string;
  extraBody: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImageInput: boolean;
  isDefault: boolean;
  isEnabled: boolean;
}

export interface ProviderLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

function providerLimitsKey(tenantId: string, workspaceId: string, providerId: string | null): string {
  return `chat:provider-limits:${encodeURIComponent(tenantId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(providerId ?? "default")}`;
}

function parseProviderLimits(value: string | null): ProviderLimits | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<ProviderLimits>;
    return typeof parsed.contextWindow === "number" &&
      Number.isFinite(parsed.contextWindow) &&
      parsed.contextWindow > 0 &&
      typeof parsed.maxOutputTokens === "number" &&
      Number.isFinite(parsed.maxOutputTokens) &&
      parsed.maxOutputTokens >= 0
      ? {
          contextWindow: parsed.contextWindow,
          maxOutputTokens: parsed.maxOutputTokens,
        }
      : null;
  } catch {
    return null;
  }
}

/** L1 skill listing resolved for a bot: name/description advertised in
 *  `<available_skills>`, `id` used to pull the body via `getSkillBody`. */
export interface AgentSkillRef {
  id: string;
  name: string;
  description: string;
}

export type SkillFileResource =
  | { storageKind: "inline"; mimeType: string | null; content: string }
  | {
      storageKind: "asset";
      mimeType: string | null;
      assetId: string;
      revisionId: string;
      sizeBytes: number;
      sha256: string;
      url: string;
    };

export interface ResolvedAgentProviders {
  agentId: string;
  agentName: string;
  profile: BotProfileSnapshot;
  text: (ProviderSnapshot & LanguageProviderSnapshot) | null;
  image: ProviderSnapshot | null;
  video: ProviderSnapshot | null;
  skills: AgentSkillRef[];
}

function adminClient() {
  const settings = getServerSettings();
  return {
    providers: new ProviderServiceClient(settings.adminRpcTarget, insecureChannelCredentials),
    agents: new AgentConfigurationServiceClient(settings.adminRpcTarget, insecureChannelCredentials),
    caller: new InnerApiCaller("runtime"),
  };
}

function toSnapshot(data: ModelProvider): ProviderSnapshot {
  return {
    id: data.id,
    userId: data.userId,
    name: data.name,
    model: data.model,
    providerKind: providerKind(data.providerKind),
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    extraBody: data.extraBody ?? {},
    contextWindow: data.contextWindow,
    maxOutputTokens: data.maxOutputTokens,
    supportsImageInput: data.supportsImageInput,
    isDefault: data.isDefault,
    isEnabled: data.isEnabled,
  };
}

function providerKind(value: ProviderKind): string {
  return (
    (
      {
        [ProviderKind.PROVIDER_KIND_CHAT]: "chat",
        [ProviderKind.PROVIDER_KIND_IMAGE]: "image",
        [ProviderKind.PROVIDER_KIND_VIDEO]: "video",
        [ProviderKind.PROVIDER_KIND_EMBEDDING]: "embedding",
        [ProviderKind.PROVIDER_KIND_RERANK]: "rerank",
      } as Record<number, string>
    )[value] ?? ""
  );
}

function actor(userId: string, tenantId: string, workspaceId: string) {
  return { userId, tenantId, workspaceId };
}

async function assertSnapshotUrl(snapshot: ProviderSnapshot): Promise<ProviderSnapshot> {
  try {
    await assertPublicProviderUrl(snapshot.baseUrl);
  } catch (error) {
    throw new ProviderNotConfiguredError(`provider base URL is not allowed: ${String(error)}`);
  }
  return snapshot;
}

export async function getProvider(
  tenantId: string,
  workspaceId: string,
  providerId?: string | null,
): Promise<ProviderSnapshot & LanguageProviderSnapshot> {
  let data: ModelProvider | undefined;
  try {
    const client = adminClient();
    const response = providerId
      ? await client.caller.unary<{ provider?: ModelProvider }>(
          (metadata, options, callback) =>
            client.providers.getProvider(
              { actor: actor("", tenantId, workspaceId), providerId },
              metadata,
              options,
              callback,
            ),
          { headers: propagationHeaders() },
        )
      : await client.caller.unary<{ provider?: ModelProvider }>(
          (metadata, options, callback) =>
            client.providers.getDefaultProvider(
              { actor: actor("", tenantId, workspaceId) },
              metadata,
              options,
              callback,
            ),
          { headers: propagationHeaders() },
        );
    data = response.provider;
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new ProviderNotConfiguredError("no model provider configured");
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  if (!data) throw new AdminUnavailableError("admin returned no provider");
  const provider = await assertSnapshotUrl(toSnapshot(data));
  if (provider.providerKind !== "chat") {
    throw new ProviderNotConfiguredError(`provider ${provider.id} is not a configured language provider`);
  }
  return provider as ProviderSnapshot & LanguageProviderSnapshot;
}

export async function getProviderLimits(
  tenantId: string,
  workspaceId: string,
  providerId?: string | null,
): Promise<ProviderLimits> {
  const cache = getRedisClient();
  const key = providerLimitsKey(tenantId, workspaceId, providerId ?? null);
  const cached = await cache
    .get(key)
    .then(parseProviderLimits)
    .catch(() => null);
  if (cached) {
    return cached;
  }

  const provider = await getProvider(tenantId, workspaceId, providerId);
  const limits = {
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,
  };
  await cache
    .set(key, JSON.stringify(limits), "EX", getServerSettings().providerCacheTtlSeconds)
    .catch(() => undefined);
  return limits;
}

export async function getAgent(
  userId: string,
  agentId: string,
  tenantId: string,
  workspaceId: string,
): Promise<ResolvedAgentProviders> {
  let data: ResolvedAgent | undefined;
  try {
    const client = adminClient();
    data = (
      await client.caller.unary<GetResolvedAgentResponse>(
        (metadata, options, callback) =>
          client.agents.getResolvedAgent(
            { actor: actor(userId, tenantId, workspaceId), agentId },
            metadata,
            options,
            callback,
          ),
        { headers: propagationHeaders() },
      )
    ).agent;
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new ProviderNotConfiguredError(`agent ${agentId} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  if (!data) throw new AdminUnavailableError("admin returned no agent");
  const resolve = async (p: ModelProvider | undefined) => (p ? assertSnapshotUrl(toSnapshot(p)) : null);
  const text = await resolve(data.textProvider);
  if (text && text.providerKind !== "chat") {
    throw new ProviderNotConfiguredError(`provider ${text.id} is not a configured language provider`);
  }
  return {
    agentId: data.id,
    agentName: data.name,
    profile: {
      name: data.name,
      roleDescription: data.roleDescription ?? null,
      domainDescription: data.domainDescription ?? null,
      audience: data.audience ?? null,
      tone: (data.tone || null) as BotTone | null,
    },
    text: text as (ProviderSnapshot & LanguageProviderSnapshot) | null,
    image: await resolve(data.imageProvider),
    video: await resolve(data.videoProvider),
    skills: data.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    })),
  };
}

/** Pulls a skill's full L2 body on demand (progressive disclosure). Called by
 *  `load_skill` and by explicit `/` activation — never at prompt-assembly time. */
export async function getSkillBody(
  skillId: string,
  tenantId: string,
  workspaceId: string,
): Promise<{ id: string; name: string; body: string; files: string[] }> {
  let data;
  try {
    const client = adminClient();
    data = (
      await client.caller.unary<GetSkillResponse>(
        (metadata, options, callback) =>
          client.agents.getSkill({ actor: actor("", tenantId, workspaceId), skillId }, metadata, options, callback),
        { headers: propagationHeaders() },
      )
    ).skill;
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new RequestError(`skill ${skillId} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  if (!data) throw new AdminUnavailableError("admin returned no skill");
  return { id: data.id, name: data.name, body: data.body, files: data.files };
}

export async function getSkillFile(
  skillId: string,
  tenantId: string,
  workspaceId: string,
  path: string,
): Promise<SkillFileResource> {
  try {
    const client = adminClient();
    const file = (
      await client.caller.unary<GetSkillFileResponse>(
        (metadata, options, callback) =>
          client.agents.getSkillFile(
            { actor: actor("", tenantId, workspaceId), skillId, path },
            metadata,
            options,
            callback,
          ),
        { headers: propagationHeaders() },
      )
    ).file;
    if (!file) throw new AdminUnavailableError(`admin returned no skill file for ${path}`);
    if (file.storageKind === "inline" && typeof file.content === "string") {
      return { storageKind: "inline", mimeType: file.mimeType ?? null, content: file.content };
    }
    if (
      file.storageKind === "asset" &&
      file.assetId &&
      file.revisionId &&
      typeof file.sizeBytes === "number" &&
      file.sha256 &&
      file.url
    ) {
      return {
        storageKind: "asset",
        mimeType: file.mimeType ?? null,
        assetId: file.assetId,
        revisionId: file.revisionId,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        url: file.url,
      };
    }
    throw new AdminUnavailableError(`admin returned an invalid skill file descriptor for ${path}`);
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
      throw new RequestError(`skill file ${path} not found`);
    }
    if (err instanceof AdminUnavailableError) {
      throw err;
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
}
