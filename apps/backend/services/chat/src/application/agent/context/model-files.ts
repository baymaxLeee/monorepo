import { isFileUIPart, isReasoningFileUIPart, type UIMessage } from "ai";

import { getDocumentSource } from "../../../infrastructure/clients/knowledge.js";
import { storageClient } from "../../../infrastructure/clients/storage.js";
import { getConversationFile } from "../../conversation-files.js";
import { RequestError } from "../../errors.js";
import { conversationFileIdFromFilePart, documentIdFromFilePart, isImageMediaType } from "./file-parts.js";
import { escapeXmlText } from "./instructions/xml.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

async function getConversationFileSource(
  context: { userId: string; tenantId: string; workspaceId: string; conversationId: string; signal: AbortSignal },
  fileId: string,
  maxDim?: number,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const file = await getConversationFile(context, context.conversationId, fileId);
  const stream = await storageClient().content({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
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

/** Stable resource references stay in the journal. Only the model projection reads bytes. */
export async function transformFilePartsForModel(
  messages: AnyUIMessage[],
  context: {
    userId: string;
    tenantId: string;
    workspaceId: string;
    conversationId: string;
    supportsImageInput: boolean;
    signal: AbortSignal;
  },
  readSource = getDocumentSource,
  readFileSource = getConversationFileSource,
): Promise<AnyUIMessage[]> {
  const sources = new Map<string, ReturnType<typeof getDocumentSource>>();
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
          const fileId = conversationFileIdFromFilePart(part);
          if (!documentId && !fileId) throw new RequestError("model file is missing its authorized resource reference");
          if (message.role === "user" && fileId) {
            throw new RequestError("user file attachments must reference Knowledge documents");
          }
          if (message.role === "user" && (!isImageMediaType(part.mediaType) || !context.supportsImageInput)) {
            return {
              type: "text" as const,
              text: `<document_reference>${escapeXmlText(
                JSON.stringify({
                  documentId,
                  mediaType: part.mediaType,
                  filename: "filename" in part ? part.filename : undefined,
                  ...(isImageMediaType(part.mediaType) ? { imageContentAvailable: false } : {}),
                }),
              )}</document_reference>`,
            };
          }
          context.signal.throwIfAborted();
          const maxDim = isImageMediaType(part.mediaType) ? 1536 : undefined;
          const sourceKey = `${documentId ? `document:${documentId}` : `file:${fileId}`}:${maxDim ?? "original"}`;
          // Coalesce repeated references inside one projection without retaining bytes across runs.
          let source = sources.get(sourceKey);
          if (!source) {
            source = documentId
              ? readSource(context.userId, documentId, {
                  maxDim,
                  conversationId: context.conversationId,
                  signal: context.signal,
                })
              : readFileSource(context, fileId!, maxDim);
            sources.set(sourceKey, source);
          }
          const { bytes, mimeType } = await source;
          context.signal.throwIfAborted();
          return {
            ...part,
            mediaType: mimeType,
            url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
          };
        }),
      ),
    })),
  );
}
