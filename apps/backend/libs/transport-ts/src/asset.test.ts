import assert from "node:assert/strict";
import test from "node:test";

import { AssetInternalClient } from "./asset.js";

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
    const client = new AssetInternalClient({
      baseUrl: "http://asset.internal",
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
      "http://asset.internal/internal/assets?tenant_id=tenant&workspace_id=workspace&user_id=user&filename=video.mp4&category=generated-video&idempotency_key=step-1",
    );
    assert.equal(request?.body, body);
    assert.equal(request?.duplex, "half");
    assert.equal(new Headers(request?.headers).get("content-length"), "3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
