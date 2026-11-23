import { createHash } from "node:crypto";

import type { ToolSet } from "@ai-sdk/provider-utils";
import { fileDataChunks, isToolOutcome } from "@repo/agent-runtime";
import {
  isToolUIPart,
  toUIMessageStream,
  type TextStreamPart,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOnEndCallback,
} from "ai";

import { uploadAsset } from "../../../infrastructure/clients/storage.js";
import { RequestError } from "../../errors.js";
import { getSessionFile, publishSessionFile, type SessionFile } from "../../session-files.js";
import { workspaceFilename } from "../../workspace-paths.js";
import { sessionFileIdFromUrl, sessionFileUrl } from "../context/file-parts.js";

type AnyUIMessage = UIMessage<unknown, any, any>;
type AgentStreamEndEvent = Parameters<UIMessageStreamOnEndCallback<AnyUIMessage>>[0];

type NativeFileChunk = Extract<UIMessageChunk, { type: "file" | "reasoning-file" }>;
type NativeSourceChunk = Extract<UIMessageChunk, { type: "source-url" | "source-document" }>;
type SourceProjection = { kind: "url-results" } | { kind: "document-results"; resolver: string };

function sourceProjection(part: { toolMetadata?: unknown }): SourceProjection | null {
  if (!part.toolMetadata || typeof part.toolMetadata !== "object" || Array.isArray(part.toolMetadata)) return null;
  const agent = (part.toolMetadata as Record<string, unknown>).agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return null;
  const projection = (agent as Record<string, unknown>).sourceProjection;
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) return null;
  const candidate = projection as Record<string, unknown>;
  if (candidate.kind === "url-results") return { kind: "url-results" };
  if (candidate.kind === "document-results" && typeof candidate.resolver === "string" && candidate.resolver) {
    return { kind: "document-results", resolver: candidate.resolver };
  }
  return null;
}

export interface NativePartDependencies {
  fetchDataUrl: typeof fetch;
  uploadAsset: typeof uploadAsset;
  publishSessionFile: typeof publishSessionFile;
  getSessionFile: typeof getSessionFile;
}

const nativePartDependencies: NativePartDependencies = {
  fetchDataUrl: fetch,
  uploadAsset,
  publishSessionFile,
  getSessionFile,
};

export interface NativeFilePublicationContext {
  attemptEpoch: string;
  runId: string;
  sessionId: string;
  signal: AbortSignal;
  stageWorkspaceFile?: (file: SessionFile, content: Uint8Array, signal: AbortSignal) => Promise<void>;
}

/**
 * Keep the AI SDK as the only model-stream reducer while replacing ephemeral
 * model file data URLs with stable, session-authorized resources. The
 * returned completion promise is also the failure channel used by the outer
 * SDK stream owner, so an upstream or publication error cannot leave execute()
 * waiting forever or emit a successful finish.
 */
export function createPublishedAgentPartStream<TOOLS extends ToolSet>(input: {
  modelStream: ReadableStream<TextStreamPart<TOOLS>>;
  tools: TOOLS;
  originalMessages: AnyUIMessage[];
  assistantMessageId: string;
  publicationContext: NativeFilePublicationContext;
  onError: (error: unknown) => string;
  dependencies?: NativePartDependencies;
}): { stream: ReadableStream<UIMessageChunk>; end: Promise<AgentStreamEndEvent> } {
  const dependencies = input.dependencies ?? nativePartDependencies;
  let endEvent: AgentStreamEndEvent | undefined;
  let resolveEnd!: (event: AgentStreamEndEvent) => void;
  let rejectEnd!: (error: unknown) => void;
  let endSettled = false;
  const end = new Promise<AgentStreamEndEvent>((resolve, reject) => {
    resolveEnd = resolve;
    rejectEnd = reject;
  });
  const settleEnd = (event: AgentStreamEndEvent) => {
    if (endSettled) return;
    endSettled = true;
    resolveEnd(event);
  };
  const failEnd = (error: unknown) => {
    if (endSettled) return;
    endSettled = true;
    rejectEnd(error);
  };

  const sdkStream = toUIMessageStream<TOOLS, AnyUIMessage>({
    stream: input.modelStream,
    tools: input.tools,
    originalMessages: input.originalMessages,
    generateMessageId: () => input.assistantMessageId,
    sendSources: true,
    sendStart: false,
    // Let the SDK observe the finish reason, then suppress its envelope below.
    sendFinish: true,
    onError: input.onError,
    onEnd: (event) => {
      endEvent = event;
    },
  });
  const reader = sdkStream.getReader();
  let closed = false;
  let fileIndex = 0;

  const stream = new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      if (closed) return;
      try {
        while (true) {
          const next = await reader.read();
          if (!next.done) {
            const chunk = next.value;
            if (chunk.type === "finish") continue;
            if (chunk.type === "file" || chunk.type === "reasoning-file") {
              const [published] = await publishNativeFileParts(
                [chunk],
                input.publicationContext,
                dependencies,
                fileIndex++,
              );
              controller.enqueue(published);
            } else {
              controller.enqueue(chunk);
              for (const file of fileDataChunks(chunk)) controller.enqueue(file);
            }
            return;
          }

          closed = true;
          reader.releaseLock();
          if (!endEvent) throw new Error("AI SDK stream ended without an onEnd event");
          // Completed search evidence survives a later tool/provider failure.
          const projectedSources = await projectSearchSourceParts(endEvent.responseMessage.parts);
          for (const part of projectedSources) controller.enqueue(part);
          settleEnd(endEvent);
          controller.close();
          return;
        }
      } catch (error) {
        closed = true;
        failEnd(error);
        // Publication can fail before the provider finishes. Release its reader
        // rather than leaving the upstream stream locked and producing bytes.
        try {
          await reader.cancel(error);
        } catch {
          // Keep the original provider/publication failure.
        } finally {
          reader.releaseLock();
        }
        // execute() owns the single public error chunk; closing here avoids a
        // second error from writer.merge while still making persistence fail.
        try {
          controller.close();
        } catch {
          // The consumer may already have cancelled the stream.
        }
      }
    },
    async cancel(reason) {
      if (closed) return;
      closed = true;
      try {
        await reader.cancel(reason);
        reader.releaseLock();
        if (!endEvent) throw new Error("AI SDK stream cancellation did not produce an onEnd event");
        settleEnd(endEvent);
      } catch (error) {
        failEnd(error);
        throw error;
      }
    },
  });

  return { stream, end };
}

function nativeFileExtension(mediaType: string): string {
  return (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "application/pdf": "pdf",
      "text/plain": "txt",
      "text/markdown": "md",
      "application/json": "json",
      "audio/mpeg": "mp3",
      "video/mp4": "mp4",
    }[mediaType] ?? "bin"
  );
}

export async function publishNativeFileParts(
  parts: AnyUIMessage["parts"],
  context: NativeFilePublicationContext,
  dependencies: NativePartDependencies = nativePartDependencies,
  firstFileIndex = 0,
): Promise<NativeFileChunk[]> {
  const published: NativeFileChunk[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.type !== "file" && part.type !== "reasoning-file") continue;
    const existingFileId = sessionFileIdFromUrl(part.url, context.sessionId);
    if (existingFileId) {
      await dependencies.getSessionFile(context.sessionId, existingFileId);
      published.push(part);
      continue;
    }

    context.signal.throwIfAborted();
    const dataPrefix = `data:${part.mediaType};base64,`;
    if (!part.url.startsWith(dataPrefix)) {
      throw new RequestError("model files must use SDK data URLs or an authorized session resource");
    }
    const response = await dependencies.fetchDataUrl(part.url, { signal: context.signal });
    if (!response.ok) throw new Error("model file data URL could not be decoded");
    const bytes = new Uint8Array(await response.arrayBuffer());
    context.signal.throwIfAborted();
    const ordinal = firstFileIndex + index + 1;
    const filename =
      (part.type === "file" && part.filename && workspaceFilename(part.filename)) ||
      `${part.type}-${ordinal}.${nativeFileExtension(part.mediaType)}`;
    const workspacePath = `/workspace/outputs/${context.runId}/${ordinal}/${filename}`;
    const idempotencyKey = `${context.runId}:native-file:${ordinal - 1}`;
    const asset = await dependencies.uploadAsset({
      filename,
      mediaType: part.mediaType,
      category: part.type === "reasoning-file" ? "reasoning-file" : "model-file",
      bytes,
      idempotencyKey,
      signal: context.signal,
    });
    const file = await dependencies.publishSessionFile({
      sessionId: context.sessionId,
      title: filename,
      assetId: asset.assetId,
      revisionId: asset.revisionId,
      filename: asset.filename,
      mediaType: asset.mediaType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      idempotencyKey,
      workspacePath,
      writerType: "agent",
      writerId: context.runId,
      sandboxAttempt: { runId: context.runId, attemptEpoch: context.attemptEpoch },
      checkedOut: false,
    });
    await context.stageWorkspaceFile?.(file, bytes, context.signal);
    const url = sessionFileUrl(context.sessionId, file.id);
    published.push({ ...part, url });
  }
  return published;
}

export async function projectSearchSourceParts(parts: AnyUIMessage["parts"]): Promise<NativeSourceChunk[]> {
  const projected: NativeSourceChunk[] = [];
  const sourceIds = new Set(
    parts.flatMap((part) => (part.type === "source-url" || part.type === "source-document" ? [part.sourceId] : [])),
  );
  for (const part of parts) {
    if (!isToolUIPart(part) || part.state !== "output-available" || part.preliminary) continue;
    const outcome = isToolOutcome(part.output) ? part.output : null;
    if (!outcome || outcome.status !== "completed" || !outcome.data || typeof outcome.data !== "object") continue;
    const results = "results" in outcome.data && Array.isArray(outcome.data.results) ? outcome.data.results : [];
    const projection = sourceProjection(part);
    if (projection?.kind === "url-results") {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (typeof row.url !== "string") continue;
        let url: URL;
        try {
          url = new URL(row.url);
        } catch {
          continue;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        const sourceId = `web-${createHash("sha256").update(url.href).digest("hex").slice(0, 20)}`;
        if (sourceIds.has(sourceId)) continue;
        sourceIds.add(sourceId);
        projected.push({
          type: "source-url",
          sourceId,
          url: url.href,
          ...(typeof row.title === "string" && row.title ? { title: row.title } : {}),
        });
      }
    }
    if (projection?.kind === "document-results") {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (typeof row.document_id !== "string" || sourceIds.has(row.document_id)) continue;
        sourceIds.add(row.document_id);
        projected.push({
          type: "source-document",
          sourceId: row.document_id,
          mediaType: typeof row.media_type === "string" ? row.media_type : "application/octet-stream",
          title: typeof row.title === "string" && row.title ? row.title : "Knowledge source",
          ...(typeof row.filename === "string" && row.filename ? { filename: row.filename } : {}),
          providerMetadata: { chat: { resolver: projection.resolver } },
        });
      }
    }
  }
  return projected;
}
