import { InnerApiCaller, InnerApiError, insecureChannelCredentials } from "@backend/inner-api/client";
import {
  AssetServiceClient,
  UploadSessionServiceClient,
  type CreateUploadSessionRequest,
  type CreateUploadSessionResponse,
  type DescribeUploadSessionRequest,
  type DescribeUploadSessionResponse,
  type DescribeRevisionRequest,
  type DescribeRevisionResponse,
  ClaimKind,
  ClaimServiceClient,
  DeliveryServiceClient,
  type AppendRevisionMetadata,
  type AppendRevisionResponse,
  type UploadMetadata,
  type UploadResponse,
} from "@backend/inner-api/gen/storage/v1/storage";

import { propagationHeaders } from "#runtime/foundation";

import { getServerSettings } from "../../config/server.js";

export interface StorageRevision {
  assetId: string;
  revisionId: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}
export interface StorageClaimIdentity {
  ownerType: string;
  ownerId: string;
  slot: string;
  generation: number;
}
export type StorageUploadBody = Blob | Uint8Array | ReadableStream<Uint8Array>;

export class StorageClient {
  private readonly caller: InnerApiCaller;
  private readonly assets: AssetServiceClient;
  private readonly uploads: UploadSessionServiceClient;
  private readonly claims: ClaimServiceClient;
  private readonly delivery: DeliveryServiceClient;

  constructor(target: string, token: string) {
    this.caller = new InnerApiCaller("runtime", token, 180_000);
    this.assets = new AssetServiceClient(target, insecureChannelCredentials);
    this.uploads = new UploadSessionServiceClient(target, insecureChannelCredentials);
    this.claims = new ClaimServiceClient(target, insecureChannelCredentials);
    this.delivery = new DeliveryServiceClient(target, insecureChannelCredentials);
  }

  async createUploadSession(request: CreateUploadSessionRequest) {
    const { session } = await this.caller.unary<CreateUploadSessionResponse>(
      (m, o, cb) => this.uploads.createUploadSession(request, m, o, cb),
      { headers: propagationHeaders() },
    );
    if (!session) throw new Error("Storage returned no upload session");
    return session;
  }

  async describeUploadSession(request: DescribeUploadSessionRequest) {
    const { session } = await this.caller.unary<DescribeUploadSessionResponse>(
      (m, o, cb) => this.uploads.describeUploadSession(request, m, o, cb),
      { headers: propagationHeaders() },
    );
    if (!session) throw new Error("Storage returned no upload session");
    return session;
  }

  async describeRevision(request: DescribeRevisionRequest) {
    const { revision } = await this.caller.unary<DescribeRevisionResponse>(
      (m, o, cb) => this.assets.describeRevision(request, m, o, cb),
      { headers: propagationHeaders() },
    );
    if (!revision) throw new Error("Storage returned no revision metadata");
    return revision;
  }

  content(input: {
    assetId: string;
    revisionId: string;
    signal?: AbortSignal;
    maxDim?: number;
  }): Promise<ReadableStream<Uint8Array>> {
    const metadata = this.caller.metadata(propagationHeaders());
    const options = this.caller.deadline(180_000);
    const stream = input.maxDim
      ? this.assets.readImageVariant(
          { assetId: input.assetId, revisionId: input.revisionId, maxDimension: input.maxDim },
          metadata,
          options,
        )
      : this.assets.readContent(
          { assetId: input.assetId, revisionId: input.revisionId, offset: undefined, limit: undefined },
          metadata,
          options,
        );
    const cancel = () => stream.cancel();
    let finished = false;
    const finish = () => {
      finished = true;
      input.signal?.removeEventListener("abort", cancel);
    };
    return Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on("data", (message) => {
            const chunk = message.value?.value?.$case === "chunk" ? message.value.value.chunk : undefined;
            if (!finished && chunk) controller.enqueue(chunk);
          });
          stream.on("end", () => {
            if (finished) return;
            finish();
            controller.close();
          });
          stream.on("error", (error) => {
            if (finished) return;
            finish();
            controller.error(
              "code" in error && typeof error.code === "number" ? new InnerApiError(error.code, error.message) : error,
            );
          });
          if (input.signal?.aborted) cancel();
          else input.signal?.addEventListener("abort", cancel, { once: true });
        },
        cancel() {
          finish();
          stream.cancel();
        },
      }),
    );
  }

  async mintDelivery(input: { assetId: string; revisionId: string; maxDim?: number }) {
    const response = await this.caller.unary<{
      items: Array<{
        assetId: string;
        revisionId: string;
        url: string;
        expiresAt?: string;
        filename: string;
        mediaType: string;
        sizeBytes: number;
      }>;
    }>(
      (metadata, options, callback) =>
        this.delivery.mintCapabilities(
          {
            items: [
              {
                assetId: input.assetId,
                revisionId: input.revisionId,
                maxDimension: input.maxDim,
              },
            ],
          },
          metadata,
          options,
          callback,
        ),
      { headers: propagationHeaders() },
    );
    const value = response.items[0];
    if (!value) throw new Error("storage returned no delivery capability");
    return {
      asset_id: value.assetId,
      revision_id: value.revisionId,
      url: value.url,
      expires_at: value.expiresAt ?? "",
      filename: value.filename,
      media_type: value.mediaType,
      size_bytes: value.sizeBytes,
    };
  }

  async prepareClaim(
    input: StorageClaimIdentity & {
      assetId: string;
      revisionId: string;
      kind: "strong" | "snapshot" | "lease" | "weak";
      expiresAt?: string;
    },
  ): Promise<void> {
    const kinds = {
      strong: ClaimKind.CLAIM_KIND_STRONG,
      snapshot: ClaimKind.CLAIM_KIND_SNAPSHOT,
      lease: ClaimKind.CLAIM_KIND_LEASE,
      weak: ClaimKind.CLAIM_KIND_WEAK,
    };
    await this.caller.unary(
      (metadata, options, callback) =>
        this.claims.prepareClaim(
          {
            ownerType: input.ownerType,
            ownerId: input.ownerId,
            slot: input.slot,
            generation: input.generation,
            assetId: input.assetId,
            revisionId: input.revisionId,
            kind: kinds[input.kind],
            expiresAt: input.expiresAt,
          },
          metadata,
          options,
          callback,
        ),
      { headers: propagationHeaders() },
    );
  }

  async activateClaim(input: StorageClaimIdentity): Promise<void> {
    await this.mutateClaim(input, false);
  }
  async releaseClaim(input: StorageClaimIdentity): Promise<void> {
    await this.mutateClaim(input, true);
  }

  private async mutateClaim(input: StorageClaimIdentity, release: boolean): Promise<void> {
    const request = {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      slot: input.slot,
      generation: input.generation,
    };
    if (release)
      await this.caller.unary(
        (metadata, options, callback) => this.claims.releaseClaim(request, metadata, options, callback),
        { headers: propagationHeaders() },
      );
    else
      await this.caller.unary(
        (metadata, options, callback) => this.claims.activateClaim(request, metadata, options, callback),
        { headers: propagationHeaders() },
      );
  }

  upload(input: {
    filename: string;
    mediaType: string;
    category: string;
    body: StorageUploadBody;
    contentLength?: number;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<StorageRevision> {
    return this.sendUpload(
      {
        filename: input.filename,
        mediaType: input.mediaType,
        idempotencyKey: input.idempotencyKey,
      },
      input.body,
      input.signal,
    );
  }

  appendRevision(
    input: StorageClaimIdentity & {
      assetId: string;
      baseRevisionId: string;
      filename: string;
      mediaType: string;
      body: StorageUploadBody;
      contentLength?: number;
      idempotencyKey: string;
      signal?: AbortSignal;
    },
  ): Promise<StorageRevision> {
    const metadata: AppendRevisionMetadata = {
      assetId: input.assetId,
      filename: input.filename,
      mediaType: input.mediaType,
      idempotencyKey: input.idempotencyKey,
      baseRevisionId: input.baseRevisionId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      slot: input.slot,
      generation: input.generation,
    };
    return this.sendStream<AppendRevisionResponse>(
      (callback) =>
        this.assets.appendRevision(this.caller.metadata(propagationHeaders()), this.caller.deadline(), callback),
      { value: { $case: "metadata", metadata } },
      (chunk) => ({ value: { $case: "chunk", chunk } }),
      input.body,
      input.signal,
    );
  }

  private sendUpload(
    metadata: UploadMetadata,
    body: StorageUploadBody,
    signal?: AbortSignal,
  ): Promise<StorageRevision> {
    return this.sendStream<UploadResponse>(
      (callback) => this.assets.upload(this.caller.metadata(propagationHeaders()), this.caller.deadline(), callback),
      { value: { $case: "metadata", metadata } },
      (chunk) => ({ value: { $case: "chunk", chunk } }),
      body,
      signal,
    );
  }

  private sendStream<T extends { result?: StorageRevision }>(
    start: (callback: (error: any, response: T) => void) => any,
    metadata: any,
    chunkMessage: (chunk: Uint8Array) => any,
    body: StorageUploadBody,
    signal?: AbortSignal,
  ): Promise<StorageRevision> {
    return new Promise((resolve, reject) => {
      const stream = start((error, response) => {
        if (error) {
          reject(this.caller.error(error));
          return;
        }
        const value = response.result;
        if (!value) {
          reject(new Error("storage returned no upload result"));
          return;
        }
        resolve(value);
      });
      signal?.addEventListener("abort", () => stream.cancel(), { once: true });
      void (async () => {
        try {
          stream.write(metadata);
          for await (const chunk of bodyChunks(body)) stream.write(chunkMessage(chunk));
          stream.end();
        } catch (error) {
          stream.cancel();
          reject(error);
        }
      })();
    });
  }
}

async function* bodyChunks(body: StorageUploadBody): AsyncGenerator<Uint8Array> {
  const stream = body instanceof Uint8Array ? new Blob([body]).stream() : body instanceof Blob ? body.stream() : body;
  const reader = stream.getReader();
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      yield value.value;
    }
  } finally {
    reader.releaseLock();
  }
}

let cached: StorageClient | undefined;
export function storageClient() {
  const settings = getServerSettings();
  return (cached ??= new StorageClient(settings.storageRpcTarget, settings.internalApiToken));
}

export function uploadAsset(input: {
  filename: string;
  mediaType: string;
  category: string;
  bytes: Uint8Array;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  return storageClient().upload({ ...input, body: input.bytes });
}
