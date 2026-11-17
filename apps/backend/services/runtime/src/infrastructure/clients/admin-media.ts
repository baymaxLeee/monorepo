import { InnerApiCaller, InnerApiError, insecureChannelCredentials } from "@backend/inner-api/client";
import { type ModelProvider, PricingUnit, ProviderServiceClient } from "@backend/inner-api/gen/admin/v1/admin";

import { assertPublicProviderUrl } from "#runtime/provider-url";

import { RequestError } from "../../application/errors.js";
import { getWorkerSettings } from "../../config/worker.js";

function adminClient() {
  const settings = getWorkerSettings();
  return {
    service: new ProviderServiceClient(settings.adminRpcTarget, insecureChannelCredentials),
    caller: new InnerApiCaller("runtime"),
  };
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
): Promise<ModelProvider> {
  try {
    const client = adminClient();
    const actor = { userId: "", tenantId, workspaceId };
    const response = existingTask
      ? await client.caller.unary<{ provider?: ModelProvider }>((metadata, options, callback) =>
          client.service.getTaskProvider({ actor, providerId }, metadata, options, callback),
        )
      : await client.caller.unary<{ provider?: ModelProvider }>((metadata, options, callback) =>
          client.service.getProvider({ actor, providerId }, metadata, options, callback),
        );
    if (!response.provider) throw new Error("admin returned no provider");
    return response.provider;
  } catch (err) {
    if (err instanceof InnerApiError && err.code === 5) {
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
  await assertProviderUrl(data.baseUrl);
  return {
    id: data.id,
    model: data.model,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    extraBody: data.extraBody ?? {},
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

export function toProviderSnapshot(data: ModelProvider): ProviderSnapshot {
  return {
    id: data.id,
    name: data.name,
    model: data.model,
    baseUrl: data.baseUrl,
    apiKey: data.apiKey,
    extraBody: data.extraBody ?? {},
    contextWindow: data.contextWindow,
    maxOutputTokens: data.maxOutputTokens,
    pricing: data.pricing
      ? {
          currency: data.pricing.currency,
          unit: data.pricing.unit === PricingUnit.PRICING_UNIT_GENERATED_SECOND ? "generated_second" : "generated_item",
          unitPriceMicros: data.pricing.unitPriceMicros,
        }
      : null,
  };
}
