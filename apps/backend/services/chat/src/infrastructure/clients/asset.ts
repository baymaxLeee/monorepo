import { propagationHeaders } from "@backend/kernel-ts";
import { AssetInternalClient } from "@backend/transport-ts";

import { getSettings } from "../../bootstrap/config.js";

export function uploadAsset(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  filename: string;
  mediaType: string;
  category: string;
  bytes: Uint8Array;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const settings = getSettings();
  return new AssetInternalClient({
    baseUrl: settings.assetServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "chat",
    propagatedHeaders: propagationHeaders,
  }).upload({ ...input, body: input.bytes });
}
