import assert from "node:assert/strict";
import test from "node:test";

import { StorageInternalClient } from "./storage.js";

test("passes streaming uploads through without materializing the body", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let request: (RequestInit & { duplex?: string }) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  globalThis.fetch = async (input, init) => {
    requestUrl = input instanceof Request ? input.url : input.toString();
    request = init;
    return Response.json({
      asset_id: "asset",
      revision_id: "revision",
      filename: "video.mp4",
      media_type: "video/mp4",
      size_bytes: 3,
      sha256: "digest",
      url: "/content",
    });
  };

  try {
    const client = new StorageInternalClient({
      baseUrl: "http://storage.internal",
      internalToken: "secret",
      callerService: "executor",
    });
    await client.upload({
      tenantId: "tenant",
      workspaceId: "workspace",
      userId: "user",
      filename: "video.mp4",
      mediaType: "video/mp4",
      category: "generated-video",
      body,
      contentLength: 3,
      idempotencyKey: "step-1",
    });

    assert.equal(
      requestUrl,
      "http://storage.internal/internal/assets?tenant_id=tenant&workspace_id=workspace&user_id=user&filename=video.mp4&category=generated-video&idempotency_key=step-1",
    );
    assert.equal(request?.body, body);
    assert.equal(request?.duplex, "half");
    assert.equal(new Headers(request?.headers).get("content-length"), "3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("binds revision append streaming to the exact asset and Claim", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let request: (RequestInit & { duplex?: string }) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });
  globalThis.fetch = async (input, init) => {
    requestUrl = input instanceof Request ? input.url : input.toString();
    request = init;
    return Response.json({
      asset_id: "asset",
      revision_id: "revision-2",
      filename: "notes.md",
      media_type: "text/markdown",
      size_bytes: 3,
      sha256: "digest",
    });
  };

  try {
    const client = new StorageInternalClient({
      baseUrl: "http://storage.internal",
      internalToken: "secret",
      callerService: "chat",
    });
    const result = await client.appendRevision({
      tenantId: "tenant",
      workspaceId: "workspace",
      userId: "user",
      assetId: "asset",
      baseRevisionId: "revision-1",
      ownerType: "conversation_file",
      ownerId: "file",
      slot: "source",
      generation: 3,
      filename: "notes.md",
      mediaType: "text/markdown",
      body,
      contentLength: 3,
      idempotencyKey: "save-1",
    });

    const url = new URL(requestUrl);
    assert.equal(url.pathname, "/internal/assets/asset/revisions");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      tenant_id: "tenant",
      workspace_id: "workspace",
      user_id: "user",
      filename: "notes.md",
      idempotency_key: "save-1",
      base_revision_id: "revision-1",
      owner_type: "conversation_file",
      owner_id: "file",
      slot: "source",
      generation: "3",
    });
    assert.equal(request?.body, body);
    assert.equal(request?.duplex, "half");
    assert.equal(result.assetId, "asset");
    assert.equal(result.revisionId, "revision-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
