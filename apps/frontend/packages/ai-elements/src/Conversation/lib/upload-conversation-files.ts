import { authFetch } from "@repo/api";
import { ingestDocuments, prepareIngest } from "@repo/api/knowledge";

export async function uploadConversationFiles({
  conversationId,
  providerId,
  items,
}: {
  conversationId: string;
  providerId?: string;
  items: Array<{ token: { id: string }; file: File }>;
}) {
  const prepared = await prepareIngest({
    conversation_id: conversationId,
    files: items.map(({ token, file }) => ({
      client_ref: token.id,
      filename: file.name,
      media_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    })),
  });
  await Promise.all(
    prepared.uploads.map(async (plan) => {
      const file = items.find(({ token }) => token.id === plan.client_ref)?.file;
      if (!file) throw new Error(`missing upload source: ${plan.client_ref}`);
      const response = await authFetch(plan.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) throw new Error(`upload failed: ${response.status}`);
    }),
  );
  return ingestDocuments({
    conversation_id: conversationId,
    provider_id: providerId,
    uploads: prepared.uploads.map((plan) => ({
      client_ref: plan.client_ref,
      upload_session_id: plan.upload_session_id,
    })),
  });
}
