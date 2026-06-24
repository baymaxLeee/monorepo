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
  isDefault: boolean;
  isEnabled: boolean;
}

const cache = new Map<string, { at: number; value: ProviderSnapshot }>();

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

  const base = settings.adminServiceUrl.replace(/\/$/, "");
  const url = providerId
    ? `${base}/internal/providers/${providerId}?user_id=${encodeURIComponent(userId)}`
    : `${base}/internal/providers/default?user_id=${encodeURIComponent(userId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "X-Internal-Token": settings.internalApiToken },
    });
  } catch (err) {
    throw new AdminUnavailableError(`admin unreachable: ${String(err)}`);
  }

  if (response.status === 404) {
    throw new ProviderNotConfiguredError("no model provider configured");
  }
  if (!response.ok) {
    throw new AdminUnavailableError(`admin refused: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const snapshot: ProviderSnapshot = {
    id: String(data.id),
    userId: String(data.user_id),
    name: String(data.name),
    model: String(data.model),
    baseUrl: String(data.base_url),
    apiKey: String(data.api_key),
    extraBody: (data.extra_body as Record<string, unknown>) ?? {},
    isDefault: Boolean(data.is_default),
    isEnabled: Boolean(data.is_enabled),
  };
  cache.set(key, { at: Date.now(), value: snapshot });
  if (!providerId) cache.set(`${userId}:${snapshot.id}`, { at: Date.now(), value: snapshot });
  return snapshot;
}
