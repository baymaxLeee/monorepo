import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { mergeArtifactValidationFindings, validateArtifactHtml } from "../artifacts/validator.js";
import { reviewArtifactHtml } from "../artifacts/reviewer.js";
import { getDocumentSource } from "../clients/knowledge.js";
import { RequestError } from "../lib/errors.js";

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
  try {
    return c.json(await reviewArtifactHtml({
      userId: input.user_id,
      orgId: input.org_id,
      providerId: input.provider_id,
      documentId: input.document_id,
      staticReport,
      abortSignal: c.req.raw.signal,
    }));
  } catch (error) {
    if (c.req.raw.signal.aborted) throw error;
    return c.json(mergeArtifactValidationFindings(staticReport, [{
      code: "REVIEW_UNAVAILABLE",
      severity: "error",
      category: "coherence",
      message: "Model-based whole-document review did not produce a valid structured result.",
      suggestion: "Retry validation with a provider that supports structured JSON output.",
      source: "model",
      actionable: true,
      evidence: { kind: "html", excerpt: String(error).slice(0, 240) },
    }]));
  }
});
