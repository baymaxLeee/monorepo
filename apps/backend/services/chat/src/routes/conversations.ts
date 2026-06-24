import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getAuth } from "../middleware/auth.js";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "../services/conversations.js";

export const conversationsRoutes = new Hono();

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  provider_id: z.string().max(32).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
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
  return c.json(await getConversation(auth, c.req.param("conversationId")));
});

conversationsRoutes.patch("/:conversationId", zValidator("json", updateSchema), async (c) => {
  const auth = getAuth(c);
  const body = c.req.valid("json");
  return c.json(await updateConversation(auth, c.req.param("conversationId"), body));
});

conversationsRoutes.delete("/:conversationId", async (c) => {
  const auth = getAuth(c);
  await deleteConversation(auth, c.req.param("conversationId"));
  return c.body(null, 204);
});
