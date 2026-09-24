import { TransportError } from "./http.js";

export interface AssetClientOptions {
  baseUrl: string;
  internalToken: string;
  callerService: string;
  timeoutMs?: number;
  propagatedHeaders?: () => Record<string, string> | undefined;
}

export interface AssetRevision {
  assetId: string;
  revisionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

export type AssetUploadBody = Blob | Uint8Array | ReadableStream<Uint8Array>;

export class AssetInternalClient {
  constructor(private readonly options: AssetClientOptions) {}

  async upload(input: {
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
  }): Promise<AssetRevision> {
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
          "asset",
          response.status,
          `asset upload failed: ${response.status}`,
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
