import { authFetch } from "@repo/api";
import { completeConversationAttachment, prepareConversationAttachment } from "@repo/api/chat";

export async function uploadConversationFile(conversationId: string, clientRef: string, file: File) {
  const mediaType = file.type || "application/octet-stream";
  const plan = await prepareConversationAttachment(conversationId, {
    client_ref: clientRef,
    filename: file.name,
    media_type: mediaType,
    size_bytes: file.size,
  });
  if (!plan.completed) {
    const response = await authFetch(plan.upload_url, {
      method: "PUT",
      headers: { "Content-Type": mediaType },
      body: file,
    });
    if (!response.ok) throw new Error(`上传失败（${response.status}）`);
  }
  return completeConversationAttachment(conversationId, { client_ref: clientRef, upload_id: plan.upload_id });
}
