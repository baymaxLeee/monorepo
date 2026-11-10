import { isFileUIPart, isReasoningFileUIPart, type UIMessage } from "ai";

import { getDocumentSource } from "../../../infrastructure/clients/knowledge.js";
import { RequestError } from "../../errors.js";
import { documentIdFromFilePart, isImageMediaType } from "./file-parts.js";
import { escapeXmlText } from "./instructions/xml.js";

type AnyUIMessage = UIMessage<unknown, any, any>;

/** Stable resource references stay in the journal. Only the model projection reads bytes. */
export async function transformFilePartsForModel(
  messages: AnyUIMessage[],
  context: { userId: string; conversationId: string; supportsImageInput: boolean; signal: AbortSignal },
  readSource = getDocumentSource,
): Promise<AnyUIMessage[]> {
  const sources = new Map<string, ReturnType<typeof getDocumentSource>>();
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map(async (part) => {
          if (!isFileUIPart(part) && !isReasoningFileUIPart(part)) return part;
          if (isFileUIPart(part) && part.providerReference != null) return part;
          const documentId = documentIdFromFilePart(part);
          if (!documentId) throw new RequestError("model file is missing its authorized resource reference");
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
          // Coalesce repeated references inside one projection without retaining bytes across runs.
          let source = sources.get(documentId);
          if (!source) {
            source = readSource(context.userId, documentId, {
              conversationId: context.conversationId,
              signal: context.signal,
            });
            sources.set(documentId, source);
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
