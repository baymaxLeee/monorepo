import { expect, test, vi } from "vitest";

import { uploadConversationFile } from "./upload-conversation-file";

const api = vi.hoisted(() => ({ prepare: vi.fn(), upload: vi.fn(), complete: vi.fn() }));
vi.mock("@repo/api", () => ({ authFetch: api.upload }));
vi.mock("@repo/api/chat", () => ({
  prepareConversationAttachment: api.prepare,
  completeConversationAttachment: api.complete,
}));

test("retry after a lost completion reuses the uploaded bytes and stable file ID", async () => {
  const file = new File(["hello"], "note.txt", { type: "text/plain" });
  const plan = { upload_id: "transfer", upload_url: "/storage" };
  api.prepare.mockResolvedValueOnce({ ...plan, completed: false }).mockResolvedValueOnce({ ...plan, completed: true });
  api.upload.mockResolvedValue(new Response(null, { status: 201 }));
  api.complete.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ id: "file" });
  await expect(uploadConversationFile("chat", "intent", file)).rejects.toThrow("timeout");
  await expect(uploadConversationFile("chat", "intent", file)).resolves.toEqual({ id: "file" });
  expect(api.upload).toHaveBeenCalledTimes(1);
  expect(api.complete.mock.calls).toEqual(Array(2).fill(["chat", { client_ref: "intent", upload_id: "transfer" }]));
});
