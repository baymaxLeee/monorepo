import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { validateArtifactHtml } from "../artifacts/validator.js";
import { getDocumentSource } from "../clients/knowledge.js";
import { RequestError } from "../lib/errors.js";

export const htmlValidationRoutes = new Hono();

const requestSchema = z.object({
  user_id: z.string().min(1).max(128),
  document_id: z.string().min(1).max(32),
});

htmlValidationRoutes.post("/", zValidator("json", requestSchema), async (c) => {
  const input = c.req.valid("json");
  const source = await getDocumentSource(input.user_id, input.document_id);
  if (source.mimeType !== "text/html") throw new RequestError("html validation only supports text/html documents");
  return c.json(validateArtifactHtml(new TextDecoder().decode(source.bytes)));
});
