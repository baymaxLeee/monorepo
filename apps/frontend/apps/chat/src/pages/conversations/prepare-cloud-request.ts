import type { ChatUIMessage } from "@repo/ai-elements/conversation";
import { buildUserFilePart } from "@repo/ai-elements/conversation/lib/file-parts";
import { uploadConversationFile } from "@repo/ai-elements/conversation/lib/upload-conversation-file";
import type { PromptInputValue } from "@repo/ai-elements/prompt-input";

export async function prepareCloudConversationRequest({
  conversationId,
  value,
}: {
  conversationId: string;
  value: PromptInputValue;
}) {
  const parts: ChatUIMessage["parts"] = [];
  for (const segment of value.segments) {
    if (segment.type === "text") {
      if (segment.text.trim()) parts.push({ type: "text", text: segment.text });
      continue;
    }
    const file = value.files[segment.token.id];
    if (!file) throw new Error("找不到所选附件，请重新选择文件");
    const attachment = await uploadConversationFile(conversationId, segment.token.id, file);
    parts.push(
      buildUserFilePart({
        conversationId,
        fileId: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mime_type,
      }),
    );
  }
  if (!parts.some((part) => part.type === "text")) {
    parts.push({ type: "text", text: "请阅读并处理我附加的文件。" });
  }
  return parts;
}
