import { createHtmlValidationDecision, type HtmlValidationDecision } from "../../domain/artifacts/decision.js";
import { validateArtifactHtml } from "../../domain/artifacts/validator.js";
import { getDocumentSource } from "../../infrastructure/clients/knowledge.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { RequestError } from "../errors.js";
import { reviewArtifactHtml } from "./reviewer.js";

export async function validateStoredArtifact(input: {
  userId: string;
  orgId: string;
  providerId: string;
  documentId: string;
  abortSignal: AbortSignal;
}): Promise<HtmlValidationDecision> {
  const source = await getDocumentSource(input.userId, input.documentId);
  if (source.mimeType !== "text/html") {
    throw new RequestError("html validation only supports text/html documents");
  }
  const staticReport = validateArtifactHtml(new TextDecoder().decode(source.bytes));
  if (!staticReport.ok) return createHtmlValidationDecision(staticReport);
  try {
    const reviewedReport = await reviewArtifactHtml({
      userId: input.userId,
      orgId: input.orgId,
      providerId: input.providerId,
      documentId: input.documentId,
      staticReport,
      abortSignal: input.abortSignal,
    });
    return createHtmlValidationDecision(reviewedReport);
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    logger.warn({ error, documentId: input.documentId }, "non-blocking HTML content review unavailable");
    return createHtmlValidationDecision(staticReport);
  }
}
