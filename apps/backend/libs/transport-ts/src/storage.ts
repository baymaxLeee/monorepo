import type { components } from "./schema/storage.js";
export type StorageDelivery = components["schemas"]["DeliveryCapability"];
import { TransportError } from "./http.js";

export interface StorageClientOptions {
  baseUrl: string;
  internalToken: string;
  callerService: string;
  timeoutMs?: number;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export interface StorageRevision {
  assetId: string;
  revisionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

export type StorageUploadBody = Blob | Uint8Array | ReadableStream<Uint8Array>;

export class StorageInternalClient {
  constructor(private readonly options: StorageClientOptions) {}

  async content(input: {
    tenantId: string;
    workspaceId: string;
    assetId: string;
    revisionId: string;
    signal?: AbortSignal;
    maxDim?: number;
  }): Promise<ReadableStream<Uint8Array>> {
    const url = new URL(
      `/internal/assets/${encodeURIComponent(input.assetId)}/revisions/${encodeURIComponent(input.revisionId)}/${input.maxDim ? "image" : "content"}`,
      this.options.baseUrl,
    );
    url.searchParams.set("tenant_id", input.tenantId);
    url.searchParams.set("workspace_id", input.workspaceId);
    if (input.maxDim) url.searchParams.set("max_dim", String(input.maxDim));
    const response = await fetch(url, {
      headers: {
        ...this.options.propagatedHeaders?.(),
        "X-Caller-Service": this.options.callerService,
        "X-Internal-Token": this.options.internalToken,
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(this.options.timeoutMs ?? 180000),
        ...(input.signal ? [input.signal] : []),
      ]),
    });
    if (!response.ok)
      throw new TransportError(
        "storage",
        response.status,
        `storage download failed: ${response.status}`,
        await response.text(),
      );
    if (!response.body) throw new Error("storage returned no content body");
    return response.body;
  }

  async mintDelivery(input: {
    tenantId: string;
    workspaceId: string;
    assetId: string;
    revisionId: string;
    maxDim?: number;
  }): Promise<StorageDelivery> {
    const response = await fetch(new URL("/internal/delivery-capabilities:mint", this.options.baseUrl), {
      method: "POST",
      headers: {
        ...this.options.propagatedHeaders?.(),
        "Content-Type": "application/json",
        "X-Caller-Service": this.options.callerService,
        "X-Internal-Token": this.options.internalToken,
      },
      body: JSON.stringify({
        items: [
          {
            tenant_id: input.tenantId,
            workspace_id: input.workspaceId,
            asset_id: input.assetId,
            revision_id: input.revisionId,
            max_dim: input.maxDim,
          },
        ],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
    });
    if (!response.ok) throw new TransportError("storage", response.status, "Storage delivery authorization failed");
    const result = (await response.json()) as { items: StorageDelivery[] };
    if (!result.items[0]) throw new Error("Storage returned no delivery capability");
    return result.items[0];
  }

  async upload(input: {
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
  }): Promise<StorageRevision> {
    const url = new URL("/internal/assets", this.options.baseUrl);
    url.searchParams.set("tenant_id", input.tenantId);
    url.searchParams.set("workspace_id", input.workspaceId);
    url.searchParams.set("user_id", input.userId);
    url.searchParams.set("filename", input.filename);
    url.searchParams.set("category", input.category);
    url.searchParams.set("idempotency_key", input.idempotencyKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 180_000);
    try {
      const headers: Record<string, string> = {
        "Content-Type": input.mediaType,
        "X-Caller-Service": this.options.callerService,
        "X-Internal-Token": this.options.internalToken,
        ...this.options.propagatedHeaders?.(),
      };
      if (input.contentLength !== undefined) {
        headers["Content-Length"] = String(input.contentLength);
      }
      const request: RequestInit & { duplex?: "half" } = {
        method: "POST",
        headers,
        body: input.body as BodyInit,
        signal: AbortSignal.any([controller.signal, ...(input.signal ? [input.signal] : [])]),
      };
      if (input.body instanceof ReadableStream) {
        request.duplex = "half";
      }
      const response = await fetch(url, request);
      if (!response.ok) {
        throw new TransportError(
          "storage",
          response.status,
          `storage upload failed: ${response.status}`,
          await response.text(),
        );
      }
      const result = (await response.json()) as {
        asset_id: string;
        revision_id: string;
        filename: string;
        media_type: string;
        size_bytes: number;
        sha256: string;
        url: string;
      };
      return {
        assetId: result.asset_id,
        revisionId: result.revision_id,
        filename: result.filename,
        mediaType: result.media_type,
        sizeBytes: result.size_bytes,
        sha256: result.sha256,
        url: result.url,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
