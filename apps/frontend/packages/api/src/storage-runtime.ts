import { authFetch } from "./auth-fetch";
import { authorizeConversationDocumentDelivery, authorizeConversationFileDelivery } from "./chat-server";
import { API_BASE_URL } from "./http";
import { authorizeDocumentDelivery } from "./knowledge-server";
import type { DeliveryCapability } from "./storage-server";

export interface StorageRevisionRef {
  assetId: string;
  revisionId: string;
}

export interface StorageDeliveryRef extends StorageRevisionRef {
  owner:
    | { kind: "conversation-document"; conversationId: string; documentId: string }
    | { kind: "conversation-file"; conversationId: string; fileId: string }
    | { kind: "knowledge-document"; documentId: string };
}

export interface AssetUploadPlan {
  uploadSessionId: string;
  intentId: string;
  state: "pending" | "uploading" | "completed" | "failed" | "aborted";
  uploadUrl: string;
  expiresAt: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  assetId?: string | null;
  revisionId?: string | null;
}

/** Execute a server-authorized byte transfer without choosing storage policy in the browser. */
export async function executeStorageUploadPlan(plan: AssetUploadPlan, file: File, signal?: AbortSignal): Promise<void> {
  if (plan.state === "completed") return;
  if (plan.state === "aborted") throw new Error("upload session has expired");
  if (file.name !== plan.filename || file.size !== plan.sizeBytes) {
    throw new Error("selected file no longer matches the authorized upload plan");
  }
  const response = await authFetch(plan.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": plan.mediaType },
    body: file,
    signal,
  });
  if (!response.ok) {
    throw new Error(`asset upload failed: ${response.status}`);
  }
}

export type StorageDownloadCapability = DeliveryCapability;

/** Authenticated control plane; the returned capability is the only credential for bytes. */
export async function createStorageDownloadUrl(
  ref: StorageDeliveryRef,
  signal?: AbortSignal,
  maxDim?: number,
): Promise<StorageDownloadCapability> {
  const owner = ref.owner;
  const options = { signal, skipErrorNotify: true };
  const capability =
    owner.kind === "knowledge-document"
      ? await authorizeDocumentDelivery(owner.documentId, options)
      : owner.kind === "conversation-document"
        ? await authorizeConversationDocumentDelivery(
            owner.conversationId,
            owner.documentId,
            maxDim ? { max_dim: maxDim } : undefined,
            options,
          )
        : await authorizeConversationFileDelivery(
            owner.conversationId,
            owner.fileId,
            { revision_id: ref.revisionId },
            options,
          );
  return { ...capability, url: new URL(capability.url, API_BASE_URL || window.location.origin).toString() };
}

/** Never attach application credentials to a signed URL (which may point at a CDN). */
export async function fetchAssetText(
  url: string,
  signal?: AbortSignal,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<string> {
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new AssetDownloadError(response.status);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const chunks: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("文件超过文本编辑大小限制");
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class AssetDownloadError extends Error {
  constructor(readonly status: number) {
    super(`文件读取失败 (${status})`);
  }
}

export function downloadAssetUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  const target = new URL(url, window.location.origin);
  target.searchParams.set("download", "1");
  anchor.href = target.toString();
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function fetchStorageBlob(ref: StorageDeliveryRef, maxDim?: number): Promise<Blob> {
  const capability = await createStorageDownloadUrl(ref, undefined, maxDim);
  const response = await fetch(capability.url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new AssetDownloadError(response.status);
  return response.blob();
}
