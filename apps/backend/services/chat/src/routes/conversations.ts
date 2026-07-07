import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getAuth } from "../middleware/auth.js";
import { activeAgentStreamRunId } from "../agent/streams/service.js";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getConversationDocument,
  getConversationDocumentSource,
  listConversations,
  updateConversation,
  updateConversationDocument,
} from "../services/conversations.js";

export const conversationsRoutes = new Hono();

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  provider_id: z.string().max(32).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content_md: z.string().optional(),
});

conversationsRoutes.get("/", async (c) => {
  const auth = getAuth(c);
  return c.json(await listConversations(auth));
});

conversationsRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  const row = await createConversation(auth, body);
  return c.json(row, 201);
});

conversationsRoutes.get("/:conversationId", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const detail = await getConversation(auth, conversationId);
  const activeRunId = await activeAgentStreamRunId(conversationId);
  return c.json({ ...detail, active_run_id: activeRunId });
});

conversationsRoutes.get("/:conversationId/documents/:documentId", async (c) => {
  const auth = getAuth(c);
  return c.json(
    await getConversationDocument(
      auth,
      c.req.param("conversationId"),
      c.req.param("documentId"),
    ),
  );
});

conversationsRoutes.get("/:conversationId/documents/:documentId/source", async (c) => {
  const auth = getAuth(c);
  const source = await getConversationDocumentSource(
    auth,
    c.req.param("conversationId"),
    c.req.param("documentId"),
  );
  const body = source.bytes.buffer.slice(
    source.bytes.byteOffset,
    source.bytes.byteOffset + source.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: { "Content-Type": source.mimeType },
  });
});

conversationsRoutes.patch("/:conversationId", zValidator("json", updateSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  return c.json(await updateConversation(auth, c.req.param("conversationId"), body));
});


conversationsRoutes.patch(
  "/:conversationId/documents/:documentId",
  zValidator("json", updateDocumentSchema),
  async (c) => {
    const auth = getAuth(c);
    const body = c.req.valid("json");
    return c.json(
      await updateConversationDocument(
        auth,
        c.req.param("conversationId"),
        c.req.param("documentId"),
        body,
      ),
    );
  },
);

conversationsRoutes.delete("/:conversationId", async (c) => {
  const auth = getAuth(c);
  await deleteConversation(auth, c.req.param("conversationId"));
  return c.body(null, 204);
});
