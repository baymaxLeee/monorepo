import type { DeliveryCapability } from "../generated/storage-server/index";
import { authFetch } from "./auth-fetch";
import { API_BASE_URL, request } from "./http";

export interface StorageRevisionRef {
  assetId: string;
  revisionId: string;
}

export interface StorageDeliveryRef extends StorageRevisionRef {
  owner:
    | { kind: "conversation-document"; conversationId: string; documentId: string }
    | { kind: "conversation-file"; conversationId: string; path: string }
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
  const url =
    owner.kind === "knowledge-document"
      ? `/api/knowledge-server/documents/${encodeURIComponent(owner.documentId)}/delivery`
      : owner.kind === "conversation-document"
        ? `/api/chat-server/conversations/${encodeURIComponent(owner.conversationId)}/documents/${encodeURIComponent(owner.documentId)}/delivery`
        : `/api/chat-server/conversations/${encodeURIComponent(owner.conversationId)}/files/delivery`;
  const capability = await request<StorageDownloadCapability>({
    url,
    method: "POST",
    params: {
      ...(maxDim ? { max_dim: maxDim } : {}),
      ...(owner.kind === "conversation-file" ? { path: owner.path } : {}),
    },
    signal,
    skipErrorNotify: true,
  });
  return { ...capability, url: new URL(capability.url, API_BASE_URL || window.location.origin).toString() };
}

/** Never attach application credentials to a signed URL (which may point at a CDN). */
export async function fetchAssetText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new AssetDownloadError(response.status);
  return new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
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
