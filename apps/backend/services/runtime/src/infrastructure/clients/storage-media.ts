import { getWorkerSettings } from "../../config/worker.js";
import { StorageClient, type StorageUploadBody } from "./storage.js";

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
  return new StorageClient(settings.storageRpcTarget).upload(input);
}
