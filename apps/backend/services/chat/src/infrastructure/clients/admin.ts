import { propagationHeaders } from "@backend/kernel-ts";
import {
  AdminInternalClient,
  TransportError,
  type AdminProviderSnapshot,
  type AdminResolvedAgent,
} from "@backend/transport-ts";
import type { LanguageApi, LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";

import type { BotProfileSnapshot } from "../../application/agent/context/instructions/index.js";
import { AdminUnavailableError, ProviderNotConfiguredError, RequestError } from "../../application/errors.js";
import { getSettings } from "../../bootstrap/config.js";
import { getRedisClient } from "../redis/index.js";

export interface ProviderSnapshot {
  id: string;
  userId: string;
  name: string;
  model: string;
  providerKind: string;
  api: LanguageApi | null;
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

function providerLimitsKey(orgId: string, providerId: string | null): string {
  return `chat:provider-limits:${encodeURIComponent(orgId)}:${encodeURIComponent(providerId ?? "default")}`;
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

export interface ResolvedAgentProviders {
  agentId: string;
  agentName: string;
  profile: BotProfileSnapshot;
  text: (ProviderSnapshot & LanguageProviderSnapshot) | null;
  image: ProviderSnapshot | null;
  video: ProviderSnapshot | null;
  skills: AgentSkillRef[];
}

function adminClient(): AdminInternalClient {
  const settings = getSettings();
  return new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
  });
}

function toSnapshot(data: AdminProviderSnapshot): ProviderSnapshot {
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    model: data.model,
    providerKind: data.provider_kind ?? "chat",
    api: (data.api as LanguageApi | null | undefined) ?? null,
    baseUrl: data.base_url,
    apiKey: data.api_key,
    extraBody: data.extra_body ?? {},
    contextWindow: data.context_window,
    maxOutputTokens: data.max_output_tokens,
    supportsImageInput: data.supports_image_input ?? false,
    isDefault: data.is_default,
    isEnabled: data.is_enabled,
  };
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
  orgId: string,
  providerId?: string | null,
): Promise<ProviderSnapshot & LanguageProviderSnapshot> {
  let data: AdminProviderSnapshot;
  try {
    const client = adminClient();
    data = providerId ? await client.getProvider(providerId, orgId) : await client.getDefaultProvider(orgId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new ProviderNotConfiguredError("no model provider configured");
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  const provider = await assertSnapshotUrl(toSnapshot(data));
  if (provider.providerKind !== "chat" || provider.api == null) {
    throw new ProviderNotConfiguredError(`provider ${provider.id} is not a configured language provider`);
  }
  return provider as ProviderSnapshot & LanguageProviderSnapshot;
}

export async function getProviderLimits(orgId: string, providerId?: string | null): Promise<ProviderLimits> {
  const cache = getRedisClient();
  const key = providerLimitsKey(orgId, providerId ?? null);
  const cached = await cache
    .get(key)
    .then(parseProviderLimits)
    .catch(() => null);
  if (cached) {
    return cached;
  }

  const provider = await getProvider(orgId, providerId);
  const limits = {
    contextWindow: provider.contextWindow,
    maxOutputTokens: provider.maxOutputTokens,
  };
  await cache.set(key, JSON.stringify(limits), "EX", getSettings().providerCacheTtlSeconds).catch(() => undefined);
  return limits;
}

export async function getAgent(userId: string, agentId: string, orgId = ""): Promise<ResolvedAgentProviders> {
  let data: AdminResolvedAgent;
  try {
    data = await adminClient().getResolvedAgent(userId, agentId, orgId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new ProviderNotConfiguredError(`agent ${agentId} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  const resolve = async (p: AdminProviderSnapshot | null | undefined) => (p ? assertSnapshotUrl(toSnapshot(p)) : null);
  const text = await resolve(data.text_provider);
  if (text && (text.providerKind !== "chat" || text.api == null)) {
    throw new ProviderNotConfiguredError(`provider ${text.id} is not a configured language provider`);
  }
  return {
    agentId: data.id,
    agentName: data.name,
    profile: {
      name: data.name,
      roleDescription: data.role_description ?? null,
      domainDescription: data.domain_description ?? null,
      audience: data.audience ?? null,
      tone: data.tone ?? null,
    },
    text: text as (ProviderSnapshot & LanguageProviderSnapshot) | null,
    image: await resolve(data.image_provider),
    video: await resolve(data.video_provider),
    skills: (data.skills ?? []).map((skill) => ({
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
  orgId: string,
): Promise<{ id: string; name: string; body: string; files: string[] }> {
  let data;
  try {
    data = await adminClient().getSkill(skillId, orgId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new RequestError(`skill ${skillId} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  return { id: data.id, name: data.name, body: data.body, files: data.files };
}

export async function getSkillFile(skillId: string, orgId: string, path: string): Promise<string> {
  try {
    return (await adminClient().getSkillFile(skillId, orgId, path)).content;
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new RequestError(`skill file ${path} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
}
