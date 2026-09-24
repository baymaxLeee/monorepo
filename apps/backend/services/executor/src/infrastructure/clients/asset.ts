import { propagationHeaders } from "@backend/kernel-ts";
import { AssetInternalClient, type AssetUploadBody } from "@backend/transport-ts";

import { getSettings } from "../../bootstrap/config.js";

export function uploadAsset(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  filename: string;
  mediaType: string;
  category: string;
  body: AssetUploadBody;
  contentLength?: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const settings = getSettings();
  return new AssetInternalClient({
    baseUrl: settings.assetServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "executor",
    propagatedHeaders: propagationHeaders,
    timeoutMs: 180_000,
  }).upload(input);
}
