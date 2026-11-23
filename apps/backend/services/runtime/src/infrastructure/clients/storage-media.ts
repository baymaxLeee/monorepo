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
  return new StorageClient(settings.storageRpcTarget).upload(input);
}

export async function readAsset(input: {
  assetId: string;
  revisionId: string;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const stream = await new StorageClient(getWorkerSettings().storageRpcTarget).content(input);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function claimTaskAsset(input: {
  taskId: string;
  slot: string;
  assetId: string;
  revisionId: string;
}): Promise<void> {
  const client = new StorageClient(getWorkerSettings().storageRpcTarget);
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
  await new StorageClient(getWorkerSettings().storageRpcTarget).releaseClaim({
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
  const capability = await new StorageClient(getWorkerSettings().storageRpcTarget).mintDelivery(input);
  return { url: capability.url, expiresAt: capability.expires_at };
}
