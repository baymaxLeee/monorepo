import { AdminInternalClient, TransportError, type AdminProviderSnapshot } from "@backend/transport-ts";
import { getSettings } from "../config.js";
import { AdminUnavailableError, ProviderNotConfiguredError } from "../lib/errors.js";

export interface ProviderSnapshot {
  id: string;
  userId: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  extraBody: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
  isDefault: boolean;
  isEnabled: boolean;
}

const cache = new Map<string, { at: number; value: ProviderSnapshot }>();

function adminClient(): AdminInternalClient {
  const settings = getSettings();
  return new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
  });
}

export async function getProvider(
  userId: string,
  providerId?: string | null,
): Promise<ProviderSnapshot> {
  const settings = getSettings();
  const key = `${userId}:${providerId ?? ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < settings.providerCacheTtlSeconds * 1000) {
    return cached.value;
  }

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

  const snapshot: ProviderSnapshot = {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    model: data.model,
    baseUrl: data.base_url,
    apiKey: data.api_key,
    extraBody: data.extra_body ?? {},
    contextWindow: data.context_window,
    maxOutputTokens: data.max_output_tokens,
    isDefault: data.is_default,
    isEnabled: data.is_enabled,
  };
  cache.set(key, { at: Date.now(), value: snapshot });
  if (!providerId) cache.set(`${userId}:${snapshot.id}`, { at: Date.now(), value: snapshot });
  return snapshot;
}
