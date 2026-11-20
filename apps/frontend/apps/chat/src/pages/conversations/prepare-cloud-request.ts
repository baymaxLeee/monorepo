import type { ChatUIMessage } from "@repo/ai-elements/conversation";
import { buildUserFilePart } from "@repo/ai-elements/conversation/lib/file-parts";
import { uploadConversationFiles } from "@repo/ai-elements/conversation/lib/upload-conversation-files";
import type { PromptInputValue } from "@repo/ai-elements/prompt-input";

export async function prepareCloudConversationRequest({
  conversationId,
  providerId,
  value,
}: {
  conversationId: string;
  providerId: string;
  value: PromptInputValue;
}) {
  const items = value.tokens.flatMap((token) => {
    const file = value.files[token.id];
    return file ? [{ token, file }] : [];
  });
  const uploaded =
    items.length > 0
      ? await uploadConversationFiles({
          conversationId,
          providerId,
          items,
        })
      : null;
  if (uploaded?.failed?.length) {
    throw new Error(uploaded.failed.map((failure) => failure.error).join("；"));
  }
  const documents = new Map(uploaded?.documents.map((item) => [item.client_ref, item.document]) ?? []);
  const parts = value.segments.flatMap((segment): ChatUIMessage["parts"][number][] => {
    if (segment.type === "text") return segment.text ? [{ type: "text", text: segment.text }] : [];
    const document = documents.get(segment.token.id);
    if (!document?.asset_id || !document.source_revision_id) return [];
    return [
      buildUserFilePart({
        conversationId,
        documentId: document.id,
        assetId: document.asset_id,
        revisionId: document.source_revision_id,
        filename: segment.token.label,
        mimeType: segment.token.mime ?? "application/octet-stream",
      }),
    ];
  });
  if (!parts.some((part) => part.type === "text")) {
    parts.push({ type: "text", text: "请阅读并处理我附加的文件。" });
  }
  return parts;
}
