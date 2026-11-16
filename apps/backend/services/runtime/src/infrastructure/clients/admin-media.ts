import { AdminInternalClient, TransportError, type AdminProviderSnapshot } from "@backend/transport-ts";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";

import { RequestError } from "../../application/errors.js";
import { getWorkerSettings } from "../../config/worker.js";

function adminClient(): AdminInternalClient {
  const settings = getWorkerSettings();
  return new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "runtime",
  });
}

export type ProviderSnapshot = {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  extraBody: Record<string, unknown>;
  contextWindow: number;
  maxOutputTokens: number;
  pricing: {
    currency: string;
    unit: "generated_item" | "generated_second";
    unitPriceMicros: number;
  } | null;
};

export type ImageProviderSnapshot = Pick<ProviderSnapshot, "id" | "model" | "baseUrl" | "apiKey" | "extraBody">;

async function loadProvider(
  providerId: string,
  tenantId: string,
  workspaceId: string,
  existingTask: boolean,
): Promise<AdminProviderSnapshot> {
  try {
    return existingTask
      ? await adminClient().getTaskProvider(providerId, tenantId, workspaceId)
      : await adminClient().getProvider(providerId, tenantId, workspaceId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new RequestError(`provider ${providerId} not found`);
    }
    throw err;
  }
}

async function assertProviderUrl(baseUrl: string): Promise<void> {
  await assertPublicProviderUrl(baseUrl).catch((error) => {
    throw new RequestError(`provider base URL is not allowed: ${String(error)}`);
  });
}

export async function getImageProvider(
  providerId: string,
  tenantId: string,
  workspaceId: string,
  existingTask = false,
): Promise<ImageProviderSnapshot> {
  const data = await loadProvider(providerId, tenantId, workspaceId, existingTask);
  await assertProviderUrl(data.base_url);
  return {
    id: data.id,
    model: data.model,
    baseUrl: data.base_url,
    apiKey: data.api_key,
    extraBody: data.extra_body ?? {},
  };
}

export async function getProvider(
  providerId: string,
  tenantId: string,
  workspaceId: string,
  existingTask = false,
): Promise<ProviderSnapshot> {
  const data = await loadProvider(providerId, tenantId, workspaceId, existingTask);
  const provider = toProviderSnapshot(data);
  await assertProviderUrl(provider.baseUrl);
  return provider;
}

export function toProviderSnapshot(data: AdminProviderSnapshot): ProviderSnapshot {
  return {
    id: data.id,
    name: data.name,
    model: data.model,
    baseUrl: data.base_url,
    apiKey: data.api_key,
    extraBody: data.extra_body ?? {},
    contextWindow: data.context_window,
    maxOutputTokens: data.max_output_tokens,
    pricing: data.pricing
      ? {
          currency: data.pricing.currency,
          unit: data.pricing.unit,
          unitPriceMicros: data.pricing.unit_price_micros,
        }
      : null,
  };
}
