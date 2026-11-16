import { propagationHeaders } from "@backend/kernel-ts";
import { StorageInternalClient } from "@backend/transport-ts";

import { getServerSettings } from "../../bootstrap/server-config.js";

export function storageClient() {
  const settings = getServerSettings();
  return new StorageInternalClient({
    baseUrl: settings.storageServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "runtime",
    propagatedHeaders: propagationHeaders,
  });
}

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
  return storageClient().upload({ ...input, body: input.bytes });
}
