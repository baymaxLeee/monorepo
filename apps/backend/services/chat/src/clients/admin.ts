import {
  AdminInternalClient,
  TransportError,
  type AdminProviderSnapshot,
  type AdminResolvedAgent,
} from "@backend/transport-ts";
import { getSettings } from "../config.js";
import { AdminUnavailableError, ProviderNotConfiguredError } from "../lib/errors.js";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";

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
  isDefault: boolean;
  isEnabled: boolean;
}

// An agent's per-capability providers, resolved once at the chat run entry and
// passed through to tools/executor from there (see clients/admin getResolvedAgent
// and ADR-0014). Any capability the agent has not configured is null.
export interface ResolvedAgentProviders {
  agentId: string;
  agentName: string;
  text: ProviderSnapshot | null;
  image: ProviderSnapshot | null;
  video: ProviderSnapshot | null;
}

function adminClient(): AdminInternalClient {
  const settings = getSettings();
  return new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
  });
}

function toSnapshot(data: AdminProviderSnapshot): ProviderSnapshot {
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    model: data.model,
    providerKind: data.provider_kind ?? "chat",
    baseUrl: data.base_url,
    apiKey: data.api_key,
    extraBody: data.extra_body ?? {},
    contextWindow: data.context_window,
    maxOutputTokens: data.max_output_tokens,
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
  userId: string,
  providerId?: string | null,
): Promise<ProviderSnapshot> {
  let data: AdminProviderSnapshot;
  try {
    const client = adminClient();
    data = providerId
      ? await client.getProvider(userId, providerId)
      : await client.getDefaultProvider(userId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new ProviderNotConfiguredError("no model provider configured");
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  return assertSnapshotUrl(toSnapshot(data));
}

// Resolve an agent to its text/image/video provider snapshots in a single admin
// call. This is the ONLY provider-resolution point for a run: the resulting
// snapshots are passed through to inline tools and (as ids) to executor tasks.
export async function getAgent(userId: string, agentId: string): Promise<ResolvedAgentProviders> {
  let data: AdminResolvedAgent;
  try {
    data = await adminClient().getResolvedAgent(userId, agentId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new ProviderNotConfiguredError(`agent ${agentId} not found`);
    }
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }
  const resolve = async (p: AdminProviderSnapshot | null | undefined) =>
    p ? assertSnapshotUrl(toSnapshot(p)) : null;
  return {
    agentId: data.id,
    agentName: data.name,
    text: await resolve(data.text_provider),
    image: await resolve(data.image_provider),
    video: await resolve(data.video_provider),
  };
}
