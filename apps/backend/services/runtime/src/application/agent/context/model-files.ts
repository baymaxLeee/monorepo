import { InnerApiError } from "@backend/inner-api/client";
import { escapeXmlText } from "@repo/agent-runtime";
import { isFileUIPart, isReasoningFileUIPart, type UIMessage } from "ai";

import { storageClient } from "../../../infrastructure/clients/storage.js";
import { RequestError } from "../../errors.js";
import { getSessionFile, getSessionAttachment, type SessionFile } from "../../session-files.js";
import { sessionFileIdFromUrl, documentIdFromFilePart, isImageMediaType } from "./file-parts.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

async function getSessionFileSource(
  context: { sessionId: string; signal: AbortSignal },
  file: SessionFile,
  maxDim?: number,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const stream = await storageClient().content({
    assetId: file.asset_id,
    revisionId: file.revision_id,
    maxDim,
    signal: context.signal,
  });
  return {
    bytes: new Uint8Array(await new Response(stream).arrayBuffer()),
    mimeType: maxDim ? "image/jpeg" : file.mime_type,
  };
}

function workspaceFileReference(file: SessionFile) {
  const reference = { path: file.workspace_path, filename: file.filename, mediaType: file.mime_type };
  return {
    type: "text" as const,
    text: `<file_reference>${escapeXmlText(JSON.stringify(reference))}</file_reference>`,
  };
}

/** Stable resource references stay in the journal. Only the model projection reads bytes. */
export async function transformFilePartsForModel(
  messages: AnyUIMessage[],
  context: {
    sessionId: string;
    supportsImageInput: boolean;
    signal: AbortSignal;
  },
  readFileSource = getSessionFileSource,
  resolveFile = getSessionFile,
  resolveAttachment = getSessionAttachment,
): Promise<AnyUIMessage[]> {
  const sources = new Map<string, Promise<{ bytes: Uint8Array; mimeType: string }>>();
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map(async (part) => {
          if (!isFileUIPart(part) && !isReasoningFileUIPart(part)) return part;
          if (isFileUIPart(part) && part.providerReference != null) {
            if (message.role === "user") {
              throw new RequestError("user file attachments cannot include a provider reference");
            }
            return part;
          }
          const documentId = documentIdFromFilePart(part);
          const fileId = sessionFileIdFromUrl(part.url, context.sessionId);
          context.signal.throwIfAborted();
          if (documentId) {
            throw new RequestError("business document references must be projected by the upper host");
          }
          if (!fileId) throw new RequestError("model file is missing its authorized resource reference");
          const file = fileId
            ? await (message.role === "user" ? resolveAttachment : resolveFile)(context.sessionId, fileId)
            : null;
          const mediaType = file?.mime_type ?? part.mediaType;
          if (message.role === "user" && file && (!isImageMediaType(mediaType) || !context.supportsImageInput)) {
            return workspaceFileReference(file);
          }
          context.signal.throwIfAborted();
          const maxDim = isImageMediaType(mediaType) ? 1536 : undefined;
          const sourceKey = `file:${fileId}:${maxDim ?? "original"}`;
          // Coalesce repeated references inside one projection without retaining bytes across runs.
          let source = sources.get(sourceKey);
          if (!source) {
            source = readFileSource(context, file!, maxDim);
            sources.set(sourceKey, source);
          }
          try {
            const { bytes, mimeType: resolvedMimeType } = await source;
            context.signal.throwIfAborted();
            return {
              ...part,
              mediaType: resolvedMimeType,
              url: `data:${resolvedMimeType};base64,${Buffer.from(bytes).toString("base64")}`,
            };
          } catch (error) {
            context.signal.throwIfAborted();
            if (message.role === "user" && file && maxDim && error instanceof InnerApiError && error.code === 3) {
              return workspaceFileReference(file);
            }
            throw error;
          }
        }),
      ),
    })),
  );
}
