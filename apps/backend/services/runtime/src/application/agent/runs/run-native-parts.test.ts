import assert from "node:assert/strict";
import test from "node:test";

import type { ToolSet } from "@ai-sdk/provider-utils";
import {
  consumeStream,
  createUIMessageStreamResponse,
  createUIMessageStream,
  DefaultGeneratedFile,
  readUIMessageStream,
  type TextStreamPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import type { SessionFile } from "../../session-files.js";
import {
  createPublishedAgentPartStream,
  publishNativeFileParts,
  type NativeFilePublicationContext,
  type NativePartDependencies,
} from "../streams/native-parts.js";

const userMessage: UIMessage = {
  id: "user",
  role: "user",
  parts: [{ type: "text", text: "hello" }],
};

const publicationContext: NativeFilePublicationContext = {
  runId: "run",
  attemptEpoch: "1",
  sessionId: "session",
  signal: new AbortController().signal,
};

function sessionFile(overrides: Partial<SessionFile> = {}): SessionFile {
  return {
    id: "file",
    session_id: "session",
    title: "Saved",
    filename: "saved.bin",
    workspace_path: "/workspace/saved.bin",
    workspace_state: "live",
    path_generation: 1,
    mime_type: "application/octet-stream",
    size: 3,
    asset_id: "asset",
    revision_id: "revision",
    sha256: "sha",
    editable: false,
    edit_max_bytes: 2_097_152,
    etag: '"00000000000000000000000000000000"',
    last_writer: { type: "agent", id: "run" },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function modelStream(parts: Array<TextStreamPart<ToolSet>>): ReadableStream<TextStreamPart<ToolSet>> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function finishPart(): TextStreamPart<ToolSet> {
  return {
    type: "finish",
    finishReason: "stop",
    rawFinishReason: undefined,
    totalUsage: {
      inputTokens: undefined,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokens: undefined,
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: undefined,
    },
  };
}

function dependencies(overrides: Partial<NativePartDependencies> = {}): NativePartDependencies {
  return {
    fetchDataUrl: fetch,
    uploadAsset: async (input) => ({
      assetId: "asset",
      revisionId: "revision",
      filename: input.filename,
      mediaType: input.mediaType,
      sizeBytes: 3,
      sha256: "sha",
    }),
    publishSessionFile: async (input) =>
      sessionFile({
        id: `file-${input.idempotencyKey.split(":").at(-1) ?? "saved"}`,
        session_id: input.sessionId,
        title: input.title,
        filename: input.filename,
        workspace_path: input.workspacePath,
        mime_type: input.mediaType,
        size: input.sizeBytes,
        asset_id: input.assetId,
        revision_id: input.revisionId,
        sha256: input.sha256,
      }),
    getSessionFile: async (sessionId, fileId) =>
      sessionFile({
        id: fileId,
        session_id: sessionId,
      }),
    ...overrides,
  };
}

test("real SDK stream projects completed search results and keeps the native tool outcome", async () => {
  const input = { query: "sdk" };
  const outcome = {
    ok: true as const,
    status: "completed" as const,
    data: {
      query: "sdk",
      results: [{ title: "SDK", url: "https://example.com/docs?q=ui#stream", snippet: "result" }],
    },
  };
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      {
        type: "tool-call",
        toolCallId: "search",
        toolName: "web_search",
        input,
        toolMetadata: { agent: { sourceProjection: { kind: "url-results" } } },
        dynamic: true,
      },
      {
        type: "tool-result",
        toolCallId: "search",
        toolName: "web_search",
        input,
        output: outcome,
        toolMetadata: { agent: { sourceProjection: { kind: "url-results" } } },
        dynamic: true,
      },
      finishPart(),
    ]),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "assistant",
    publicationContext,
    onError: () => "failed",
    dependencies: dependencies(),
  });

  const chunks = await collect(parts.stream);
  const end = await parts.end;
  assert.equal(chunks.filter((chunk) => chunk.type === "source-url").length, 1);
  assert.deepEqual(
    chunks.find((chunk) => chunk.type === "source-url"),
    {
      type: "source-url",
      sourceId: chunks.find((chunk) => chunk.type === "source-url")?.sourceId,
      title: "SDK",
      url: "https://example.com/docs?q=ui#stream",
    },
  );
  const tool = end.responseMessage.parts.find((part) => part.type === "dynamic-tool");
  assert.ok(tool?.state === "output-available");
  assert.deepEqual(tool.output, outcome);
});

test("namespaced MCP document search projects sources from manifest metadata", async () => {
  const input = { query: "runtime" };
  const outcome = {
    ok: true as const,
    status: "completed" as const,
    data: {
      results: [
        {
          document_id: "document",
          title: "Runtime architecture",
          filename: "runtime.pdf",
          media_type: "application/pdf",
        },
      ],
    },
  };
  const metadata = {
    agent: { sourceProjection: { kind: "document-results", resolver: "knowledge-document" } },
  };
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      {
        type: "tool-call",
        toolCallId: "knowledge",
        toolName: "mcp__knowledge__knowledge_search",
        input,
        toolMetadata: metadata,
        dynamic: true,
      },
      {
        type: "tool-result",
        toolCallId: "knowledge",
        toolName: "mcp__knowledge__knowledge_search",
        input,
        output: outcome,
        toolMetadata: metadata,
        dynamic: true,
      },
      finishPart(),
    ]),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "assistant",
    publicationContext,
    onError: () => "failed",
    dependencies: dependencies(),
  });

  const chunks = await collect(parts.stream);
  await parts.end;
  assert.deepEqual(
    chunks.find((chunk) => chunk.type === "source-document"),
    {
      type: "source-document",
      sourceId: "document",
      mediaType: "application/pdf",
      title: "Runtime architecture",
      filename: "runtime.pdf",
      providerMetadata: { chat: { resolver: "knowledge-document" } },
    },
  );
});

test("real SDK stream projects a published file result into a persistent artifact data part", async () => {
  const file = {
    file_id: "a".repeat(32),
    filename: "demo.js",
    title: "demo.js",
    media_type: "text/javascript",
    kind: "artifact",
    etag: `"${"b".repeat(32)}"`,
    updated: false,
  };
  const input = { artifacts: [{ operation: "create" }] };
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      { type: "tool-call", toolCallId: "save", toolName: "upload_artifacts", input, dynamic: true },
      {
        type: "tool-result",
        toolCallId: "save",
        toolName: "upload_artifacts",
        input,
        output: { ok: true, status: "completed", data: { files: [file] } },
        toolMetadata: { agent: { uiKind: "artifact" } },
        dynamic: true,
      },
      finishPart(),
    ]),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "assistant",
    publicationContext,
    onError: () => "failed",
    dependencies: dependencies(),
  });

  const chunks = await collect(parts.stream);
  await parts.end;
  assert.deepEqual(
    chunks.find((chunk) => chunk.type === "data-file"),
    {
      type: "data-file",
      id: file.file_id,
      data: file,
    },
  );
});

test("real SDK file and reasoning-file parts are published before persistence", async () => {
  const uploads: Array<{ category: string; bytes: number[] }> = [];
  const deps = dependencies({
    uploadAsset: async (input) => {
      uploads.push({ category: input.category, bytes: [...input.bytes] });
      return {
        assetId: `asset-${uploads.length}`,
        revisionId: `revision-${uploads.length}`,
        filename: input.filename,
        mediaType: input.mediaType,
        sizeBytes: 3,
        sha256: "sha",
      };
    },
    publishSessionFile: async (input) =>
      sessionFile({
        id: `file-${input.assetId}`,
        session_id: input.sessionId,
        title: input.title,
        filename: input.filename,
        workspace_path: input.workspacePath,
        mime_type: input.mediaType,
        size: input.sizeBytes,
        asset_id: input.assetId,
        revision_id: input.revisionId,
        sha256: input.sha256,
      }),
  });
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      { type: "file", file: new DefaultGeneratedFile({ data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }) },
      {
        type: "reasoning-file",
        file: new DefaultGeneratedFile({ data: new Uint8Array([4, 5, 6]), mediaType: "application/pdf" }),
      },
      finishPart(),
    ]),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "assistant",
    publicationContext,
    onError: () => "failed",
    dependencies: deps,
  });

  const chunks = await collect(parts.stream);
  await parts.end;
  assert.deepEqual(uploads, [
    { category: "model-file", bytes: [1, 2, 3] },
    { category: "reasoning-file", bytes: [4, 5, 6] },
  ]);
  assert.deepEqual(
    chunks.filter((chunk) => chunk.type === "file" || chunk.type === "reasoning-file"),
    [
      {
        type: "file",
        mediaType: "image/png",
        url: "/api/chat-server/sessions/session/files/file-asset-1/content",
      },
      {
        type: "reasoning-file",
        mediaType: "application/pdf",
        url: "/api/chat-server/sessions/session/files/file-asset-2/content",
      },
    ],
  );
});

test("publication failure rejects the owner completion and cannot produce finish", async () => {
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      { type: "file", file: new DefaultGeneratedFile({ data: new Uint8Array([1]), mediaType: "image/png" }) },
      finishPart(),
    ]),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "assistant",
    publicationContext,
    onError: () => "failed",
    dependencies: dependencies({
      uploadAsset: async () => {
        throw new Error("storage unavailable");
      },
    }),
  });

  const rejected = assert.rejects(parts.end, /storage unavailable/);
  const chunks = await collect(parts.stream);
  await rejected;
  assert.equal(
    chunks.some((chunk) => chunk.type === "finish"),
    false,
  );
  assert.equal(
    chunks.some((chunk) => chunk.type === "file"),
    false,
  );
});

test("a journaled session file rechecks ownership and reuses its canonical reference", async () => {
  const part = {
    type: "file" as const,
    mediaType: "text/plain",
    url: "/api/chat-server/sessions/session/files/file/content",
  };
  const deps = dependencies({
    fetchDataUrl: async () => assert.fail("a registered file must not be reuploaded"),
    getSessionFile: async (sessionId, fileId) => {
      assert.equal(sessionId, publicationContext.sessionId);
      assert.equal(fileId, "file");
      return sessionFile();
    },
  });
  assert.deepEqual(await publishNativeFileParts([part], publicationContext, deps), [part]);
  await assert.rejects(
    publishNativeFileParts([part], publicationContext, {
      ...deps,
      getSessionFile: async () => {
        throw new Error("unauthorized file");
      },
    }),
    /unauthorized file/,
  );
});

test("native model file publication rejects arbitrary remote URLs", async () => {
  await assert.rejects(
    publishNativeFileParts(
      [{ type: "file", mediaType: "image/png", url: "http://127.0.0.1/private" }],
      publicationContext,
      dependencies(),
    ),
    /SDK data URLs or an authorized session resource/,
  );
});

test("native model file publication rejects upper-app document URLs", async () => {
  await assert.rejects(
    publishNativeFileParts(
      [
        {
          type: "file",
          mediaType: "application/pdf",
          url: "/api/chat-server/sessions/session/documents/document/content?document_id=document",
        },
      ],
      publicationContext,
      dependencies(),
    ),
    /SDK data URLs or an authorized session resource/,
  );
});

test("native output publication fences the writer before touching the guest, with one stable path per emission", async () => {
  const paths: string[] = [];
  const events: string[] = [];
  const piece = { type: "file" as const, mediaType: "text/plain", url: "data:text/plain;base64,aGk=" };
  const context = {
    ...publicationContext,
    stageWorkspaceFile: async (file: SessionFile, content: Uint8Array) => {
      assert.deepEqual([...content], [104, 105]);
      events.push("stage");
      paths.push(file.workspace_path);
    },
  };
  const deps = dependencies({
    publishSessionFile: async (input) => {
      events.push("publish");
      assert.deepEqual(input.sandboxAttempt, { runId: "run", attemptEpoch: "1" });
      assert.equal(input.checkedOut, false);
      return dependencies().publishSessionFile(input);
    },
  });
  for (const index of [0, 1]) await publishNativeFileParts([piece], context, deps, index);
  await publishNativeFileParts([{ ...piece, filename: "result.txt" }], context, deps, 2);
  await publishNativeFileParts([{ ...piece, filename: "result.txt" }], context, deps, 3);
  assert.deepEqual(events, ["publish", "stage", "publish", "stage", "publish", "stage", "publish", "stage"]);
  assert.deepEqual(paths, [
    "/workspace/outputs/run/1/file-1.txt",
    "/workspace/outputs/run/2/file-2.txt",
    "/workspace/outputs/run/3/result.txt",
    "/workspace/outputs/run/4/result.txt",
  ]);
  await assert.rejects(
    publishNativeFileParts([piece], context, {
      ...deps,
      publishSessionFile: async () => {
        throw new Error("writer superseded");
      },
    }),
    /writer superseded/,
  );
  assert.equal(paths.length, 4);
});

test("the composed HTTP owner emits one start and one finish", async () => {
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "hello" },
      { type: "text-end", id: "text", citations: [] },
      finishPart(),
    ]),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "assistant",
    publicationContext,
    onError: () => "failed",
    dependencies: dependencies(),
  });
  const stream = createUIMessageStream({
    originalMessages: [userMessage],
    generateId: () => "assistant",
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: "assistant" });
      writer.merge(parts.stream);
      const end = await parts.end;
      writer.write({ type: "finish", finishReason: end.finishReason });
    },
  });

  const chunks = await collect(stream);
  assert.equal(chunks.filter((chunk) => chunk.type === "start").length, 1);
  assert.equal(chunks.filter((chunk) => chunk.type === "finish").length, 1);
  assert.equal(chunks.find((chunk) => chunk.type === "finish")?.finishReason, "stop");
});

test("the official producer and consumer preserve Unicode reasoning and multi-step boundaries", async () => {
  const stream = createUIMessageStream({
    generateId: () => "assistant",
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId: "assistant" });
      writer.write({ type: "start-step" });
      writer.write({ type: "reasoning-start", id: "reasoning" });
      writer.write({ type: "reasoning-delta", id: "reasoning", delta: "推理😀" });
      writer.write({ type: "reasoning-end", id: "reasoning" });
      writer.write({ type: "finish-step" });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: "answer" });
      writer.write({ type: "text-delta", id: "answer", delta: "结论 café 🚀" });
      writer.write({ type: "text-end", id: "answer" });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish", finishReason: "stop" });
    },
  });

  let finalMessage: UIMessage | undefined;
  for await (const snapshot of readUIMessageStream({ stream })) finalMessage = snapshot;
  assert.equal(finalMessage?.id, "assistant");
  assert.deepEqual(finalMessage?.parts, [
    { type: "step-start" },
    { type: "reasoning", id: "reasoning", text: "推理😀", providerMetadata: undefined, state: "done" },
    { type: "step-start" },
    { type: "text", text: "结论 café 🚀", providerMetadata: undefined, state: "done" },
  ]);
});

test("the official consumer merges metadata, reconciles stable data ids, and excludes transient data", async () => {
  type ProtocolMessage = UIMessage<
    { phase?: string; usage?: { totalTokens: number } },
    { evidence: { value: string }; notice: { text: string } }
  >;
  const wireChunks: UIMessageChunk[] = [];
  let persisted: ProtocolMessage | undefined;
  const stream = createUIMessageStream<ProtocolMessage>({
    generateId: () => "assistant",
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId: "assistant", messageMetadata: { phase: "started" } });
      writer.write({ type: "data-evidence", id: "evidence", data: { value: "first" } });
      writer.write({ type: "data-notice", data: { text: "ephemeral" }, transient: true });
      writer.write({ type: "data-evidence", id: "evidence", data: { value: "final" } });
      writer.write({ type: "message-metadata", messageMetadata: { usage: { totalTokens: 12 } } });
      writer.write({ type: "finish", finishReason: "stop", messageMetadata: { phase: "completed" } });
    },
    onEnd: ({ responseMessage }) => {
      persisted = responseMessage;
    },
  });
  const [consumerStream, auditStream] = stream.tee();
  for await (const chunk of auditStream) wireChunks.push(chunk);
  let consumed: ProtocolMessage | undefined;
  for await (const snapshot of readUIMessageStream<ProtocolMessage>({ stream: consumerStream })) consumed = snapshot;

  assert.ok(wireChunks.some((chunk) => chunk.type === "data-notice" && chunk.transient));
  for (const message of [consumed, persisted]) {
    assert.deepEqual(message?.metadata, { phase: "completed", usage: { totalTokens: 12 } });
    assert.deepEqual(message?.parts, [{ type: "data-evidence", id: "evidence", data: { value: "final" } }]);
  }
});

test("official error chunks fail consumers while abort remains an explicit finalizer outcome", async () => {
  const failed = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId: "failed" });
      writer.write({ type: "error", errorText: "provider stream failed" });
    },
  });
  await assert.rejects(async () => {
    for await (const _snapshot of readUIMessageStream({ stream: failed, terminateOnError: true })) {
      // Error delivery is owned by the SDK consumer.
    }
  }, /provider stream failed/);

  let aborted: { isAborted: boolean; status: string } | undefined;
  const abortStream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start", messageId: "aborted" });
      writer.write({ type: "text-start", id: "partial" });
      writer.write({ type: "text-delta", id: "partial", delta: "partial" });
      writer.write({ type: "abort", reason: "cancelled" });
    },
    onEnd: ({ isAborted, outcome }) => {
      aborted = { isAborted, status: outcome.status };
    },
  });
  await collect(abortStream);
  assert.deepEqual(aborted, { isAborted: true, status: "aborted" });
});

test("continuation preserves existing files exactly once and publishes new files in order", async () => {
  const oldFile = {
    type: "file" as const,
    mediaType: "image/png",
    url: "/api/chat-server/sessions/session/documents/old/content?document_id=old",
  };
  const originalMessages: UIMessage[] = [userMessage, { id: "assistant", role: "assistant", parts: [oldFile] }];
  const parts = createPublishedAgentPartStream({
    modelStream: modelStream([
      { type: "start" },
      { type: "file", file: new DefaultGeneratedFile({ data: new Uint8Array([1]), mediaType: "image/png" }) },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "after file" },
      { type: "text-end", id: "text" },
      finishPart(),
    ]),
    tools: {},
    originalMessages,
    assistantMessageId: "assistant",
    publicationContext,
    onError: String,
    dependencies: dependencies(),
  });
  let message: UIMessage | undefined;
  const stream = createUIMessageStream({
    originalMessages,
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: "assistant" });
      writer.merge(parts.stream);
      const end = await parts.end;
      writer.write({ type: "finish", finishReason: end.finishReason });
    },
    onEnd: ({ responseMessage }) => {
      message = responseMessage;
    },
  });
  await collect(stream);
  assert.deepEqual(
    message?.parts.map((part) => part.type),
    ["file", "file", "text"],
  );
  assert.equal(message?.parts.filter((part) => part.type === "file" && part.url === oldFile.url).length, 1);
});

test("the official response consumer completes persistence after the HTTP subscriber disconnects", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let persisted: UIMessage | undefined;
  let consumed: Promise<void> | undefined;
  const response = createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId: "assistant" });
        writer.write({ type: "text-start", id: "text" });
        writer.write({ type: "text-delta", id: "text", delta: "before" });
        await gate;
        writer.write({ type: "text-delta", id: "text", delta: " after" });
        writer.write({ type: "text-end", id: "text" });
        writer.write({ type: "finish", finishReason: "stop" });
      },
      onEnd: ({ responseMessage }) => {
        persisted = responseMessage;
      },
    }),
    consumeSseStream: ({ stream }) => {
      consumed = consumeStream({ stream });
    },
  });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const reader = response.body!.getReader();
  await reader.read();
  const detached = reader.cancel();
  finish();
  await Promise.all([detached, consumed]);
  assert.equal(persisted?.id, "assistant");
  assert.ok(persisted?.parts.some((part) => part.type === "text" && part.text === "before after"));
});

test("user-facing commentary arrives before a pending tool result or final answer", { timeout: 3000 }, async () => {
  let source!: ReadableStreamDefaultController<TextStreamPart<ToolSet>>;
  const { stream, end } = createPublishedAgentPartStream({
    modelStream: new ReadableStream({
      start(controller) {
        source = controller;
      },
    }),
    tools: {},
    originalMessages: [userMessage],
    assistantMessageId: "reply",
    publicationContext,
    onError: () => "failed",
    dependencies: dependencies(),
  });
  const metadata = { openai: { phase: "commentary" } };
  source.enqueue({ type: "start" });
  source.enqueue({ type: "text-start", id: "update", providerMetadata: metadata });
  source.enqueue({ type: "text-delta", id: "update", text: "榜单已确认，正在核对数据。" });
  source.enqueue({ type: "text-end", id: "update", providerMetadata: metadata });
  source.enqueue({ type: "tool-call", toolName: "web_fetch", toolCallId: "fetch", input: {}, dynamic: true });
  const reader = stream.getReader();
  let chunk = await reader.read();
  while (!chunk.done && chunk.value.type !== "text-delta") chunk = await reader.read();
  assert.ok(!chunk.done && chunk.value.type === "text-delta");
  assert.equal(chunk.value.delta, "榜单已确认，正在核对数据。");
  source.enqueue({
    type: "tool-result",
    toolName: "web_fetch",
    toolCallId: "fetch",
    input: {},
    output: "result",
    dynamic: true,
  });
  source.enqueue({ type: "text-start", id: "answer" });
  source.enqueue({ type: "text-delta", id: "answer", text: "核对完成。" });
  source.enqueue({ type: "text-end", id: "answer" });
  source.enqueue(finishPart());
  source.close();
  reader.releaseLock();
  await collect(stream);
  const saved = (await end).responseMessage.parts.filter((part) => part.type === "text");
  assert.deepEqual(
    saved.map((part) => part.text),
    ["榜单已确认，正在核对数据。", "核对完成。"],
  );
  assert.deepEqual(saved[0].providerMetadata, metadata);
});
