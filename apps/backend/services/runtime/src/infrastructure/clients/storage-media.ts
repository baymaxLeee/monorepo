import { getWorkerSettings } from "../../config/worker.js";
import { StorageClient, type StorageUploadBody } from "./storage.js";

export function uploadAsset(input: {
  filename: string;
  mediaType: string;
  category: string;
  body: StorageUploadBody;
  contentLength?: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const settings = getWorkerSettings();
  return new StorageClient(settings.storageRpcTarget, settings.internalApiToken).upload(input);
}

export async function readAsset(input: {
  assetId: string;
  revisionId: string;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const settings = getWorkerSettings();
  const stream = await new StorageClient(settings.storageRpcTarget, settings.internalApiToken).content(input);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function claimTaskAsset(input: {
  taskId: string;
  slot: string;
  assetId: string;
  revisionId: string;
}): Promise<void> {
  const settings = getWorkerSettings();
  const client = new StorageClient(settings.storageRpcTarget, settings.internalApiToken);
  const claim = { ownerType: "runtime-task", ownerId: input.taskId, slot: input.slot, generation: 1 };
  await client.prepareClaim({
    ...claim,
    assetId: input.assetId,
    revisionId: input.revisionId,
    kind: "strong",
  });
  await client.activateClaim(claim);
}

export async function releaseTaskAsset(taskId: string, slot: string): Promise<void> {
  const settings = getWorkerSettings();
  await new StorageClient(settings.storageRpcTarget, settings.internalApiToken).releaseClaim({
    ownerType: "runtime-task",
    ownerId: taskId,
    slot,
    generation: 1,
  });
}

export async function mintAssetDelivery(input: {
  assetId: string;
  revisionId: string;
  maxDim?: number;
}): Promise<{ url: string; expiresAt: string }> {
  const settings = getWorkerSettings();
  const capability = await new StorageClient(settings.storageRpcTarget, settings.internalApiToken).mintDelivery(input);
  return { url: capability.url, expiresAt: capability.expires_at };
}
