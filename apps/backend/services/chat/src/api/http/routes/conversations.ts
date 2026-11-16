import { Hono } from "hono";
import { z } from "zod";

import {
  createCanvasConversation,
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  listConversations,
  proxyConversationRequest,
  updateConversation,
} from "../../../application/conversations.js";
import { getAuth } from "../middleware/auth.js";

const createSchema = z.object({
  request_id: z.string().min(8).max(64),
  title: z.string().min(1).max(200).optional(),
  provider_id: z.string().max(32).optional().nullable(),
  project_id: z.string().max(36).optional(),
  canvas_id: z.string().max(36).optional(),
});

const conversationsRoutes = new Hono();

conversationsRoutes.get("/", async (c) => c.json(await listConversations(getAuth(c))));

conversationsRoutes.post("/", async (c) => {
  const input = createSchema.parse(await c.req.json());
  return c.json(await createConversation(getAuth(c), input, c.req.raw), 201);
});

conversationsRoutes.post("/canvas", async (c) => {
  const input = createSchema.parse(await c.req.json());
  const product = await createCanvasConversation(getAuth(c), input, c.req.raw);
  return c.json({ id: product.id, project_id: product.project_id, canvas_id: product.canvas_id }, 201);
});

conversationsRoutes.get("/:conversationId", async (c) => {
  return c.json(await getConversation(getAuth(c), c.req.param("conversationId"), c.req.raw));
});

conversationsRoutes.patch("/:conversationId", async (c) => {
  const input = z.object({ title: z.string().min(1).max(200) }).parse(await c.req.json());
  return c.json(await updateConversation(getAuth(c), c.req.param("conversationId"), input.title));
});

conversationsRoutes.delete("/:conversationId", async (c) => {
  await deleteConversation(getAuth(c), c.req.param("conversationId"), c.req.raw);
  return new Response(null, { status: 204 });
});

conversationsRoutes.post("/:conversationId/forks", async (c) => {
  const input = z.object({ message_id: z.string().min(1).max(32) }).parse(await c.req.json());
  return c.json(await forkConversation(getAuth(c), c.req.param("conversationId"), input.message_id, c.req.raw), 201);
});

conversationsRoutes.all("/:conversationId/*", async (c) => {
  const localPrefix = `/conversations/${encodeURIComponent(c.req.param("conversationId"))}`;
  const suffix = c.req.path.slice(localPrefix.length);
  return proxyConversationRequest(getAuth(c), c.req.param("conversationId"), suffix, c.req.raw);
});

export { conversationsRoutes };
