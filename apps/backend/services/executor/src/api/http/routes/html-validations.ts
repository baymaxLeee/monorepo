import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { validateStoredArtifact } from "../../../application/artifacts/validation.js";

export const htmlValidationRoutes = new Hono();

const requestSchema = z.object({
  user_id: z.string().min(1).max(128),
  document_id: z.string().min(1).max(32),
  org_id: z.string().min(1).max(26),
  provider_id: z.string().min(1).max(26),
});

htmlValidationRoutes.post("/", zValidator("json", requestSchema), async (c) => {
  const input = c.req.valid("json");
  return c.json(await validateStoredArtifact({
    userId: input.user_id,
    orgId: input.org_id,
    providerId: input.provider_id,
    documentId: input.document_id,
    abortSignal: c.req.raw.signal,
  }));
});
