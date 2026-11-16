import { propagationHeaders } from "@backend/kernel-ts";
import { StorageInternalClient, type StorageUploadBody } from "@backend/transport-ts";

import { getWorkerSettings } from "../../config/worker.js";

export function uploadAsset(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  filename: string;
  mediaType: string;
  category: string;
  body: StorageUploadBody;
  contentLength?: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const settings = getWorkerSettings();
  return new StorageInternalClient({
    baseUrl: settings.storageServiceUrl,
    internalToken: settings.internalApiToken,
    callerService: "runtime",
    propagatedHeaders: propagationHeaders,
    timeoutMs: 180_000,
  }).upload(input);
}
