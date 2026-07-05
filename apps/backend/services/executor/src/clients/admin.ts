import { AdminInternalClient, TransportError, type AdminProviderSnapshot } from "@backend/transport-ts";

import { getSettings } from "../config.js";
import { RequestError } from "../lib/errors.js";
import { assertPublicProviderUrl } from "@backend/transport-ts/provider-url";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

function adminClient(): AdminInternalClient {
  const settings = getSettings();
  return new AdminInternalClient({
    baseUrl: settings.adminServiceUrl,
    internalToken: settings.internalApiToken,
  });
}

export async function getProvider(providerId: string): Promise<ChatProvider> {
  let data: AdminProviderSnapshot;
  try {
    data = await adminClient().getProvider(providerId);
  } catch (err) {
    if (err instanceof TransportError && err.status === 404) {
      throw new RequestError(`provider ${providerId} not found`);
    }
    throw err;
  }
  const provider: ChatProvider = {
    id: data.id,
    name: data.name,
    model: data.model,
    baseUrl: data.base_url,
    apiKey: data.api_key,
    extraBody: data.extra_body ?? {},
    contextWindow: data.context_window,
    maxOutputTokens: data.max_output_tokens,
  };
  await assertPublicProviderUrl(provider.baseUrl).catch((error) => {
    throw new RequestError(`provider base URL is not allowed: ${String(error)}`);
  });
  return provider;
}
