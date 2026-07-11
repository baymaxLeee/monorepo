import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { createHtmlValidationDecision } from "../artifacts/decision.js";
import { validateArtifactHtml } from "../artifacts/validator.js";
import { reviewArtifactHtml } from "../artifacts/reviewer.js";
import { getDocumentSource } from "../clients/knowledge.js";
import { RequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const htmlValidationRoutes = new Hono();

const requestSchema = z.object({
  user_id: z.string().min(1).max(128),
  document_id: z.string().min(1).max(32),
  org_id: z.string().min(1).max(26),
  provider_id: z.string().min(1).max(26),
});

htmlValidationRoutes.post("/", zValidator("json", requestSchema), async (c) => {
  const input = c.req.valid("json");
  const source = await getDocumentSource(input.user_id, input.document_id);
  if (source.mimeType !== "text/html") throw new RequestError("html validation only supports text/html documents");
  const staticReport = validateArtifactHtml(new TextDecoder().decode(source.bytes));
  if (!staticReport.ok) return c.json(createHtmlValidationDecision(staticReport));
  try {
    const reviewedReport = await reviewArtifactHtml({
      userId: input.user_id,
      orgId: input.org_id,
      providerId: input.provider_id,
      documentId: input.document_id,
      staticReport,
      abortSignal: c.req.raw.signal,
    });
    return c.json(createHtmlValidationDecision(reviewedReport));
  } catch (error) {
    if (c.req.raw.signal.aborted) throw error;
    logger.warn({ error, documentId: input.document_id }, "non-blocking HTML content review unavailable");
    return c.json(createHtmlValidationDecision(staticReport));
  }
});
