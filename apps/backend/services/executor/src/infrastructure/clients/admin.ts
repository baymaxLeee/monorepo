import { AdminInternalClient, TransportError, type AdminProviderSnapshot } from "@backend/transport-ts";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";

import { RequestError } from "../../application/errors.js";
import { getSettings } from "../../bootstrap/config.js";

function adminClient(): AdminInternalClient {
  const settings = getSettings();
  return new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
  });
}

export type ProviderSnapshot = ChatProvider & {
  pricing: { currency: string; unit: "generated_second"; unitPriceMicros: number } | null;
};

export async function getProvider(providerId: string, orgId: string): Promise<ProviderSnapshot> {
  let data: AdminProviderSnapshot;
  try {
    data = await adminClient().getProvider(providerId, orgId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new RequestError(`provider ${providerId} not found`);
    }
    throw err;
  }
  const provider: ProviderSnapshot = {
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
  await assertPublicProviderUrl(provider.baseUrl).catch((error) => {
    throw new RequestError(`provider base URL is not allowed: ${String(error)}`);
  });
  return provider;
}
