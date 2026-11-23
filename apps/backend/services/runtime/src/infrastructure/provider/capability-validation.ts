import { assertPublicProviderUrl } from "#runtime/provider-url";

import { RequestError } from "../../application/errors.js";
import { mediaProviderCapabilitySchema, type MediaProviderCapability } from "./capability.js";

export async function validateMediaProviderCapability(
  rawCapability: unknown,
  expectedKind: MediaProviderCapability["providerKind"],
): Promise<MediaProviderCapability> {
  const capability = mediaProviderCapabilitySchema.parse(rawCapability);
  if (capability.providerKind !== expectedKind) {
    throw new RequestError(`${expectedKind} provider capability is required`);
  }
  await assertPublicProviderUrl(capability.baseUrl).catch((error) => {
    throw new RequestError(`provider base URL is not allowed: ${String(error)}`);
  });
  return capability;
}
