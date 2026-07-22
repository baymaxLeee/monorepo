import type { ChatProvider } from "@backend/transport-ts/provider-model";

import { getDocumentSource } from "../../../infrastructure/clients/knowledge.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { RequestError } from "../../errors.js";
import { reviewArtifactHtml } from "./html-reviewer.js";
import {
  validateArtifactHtml,
  type HtmlValidationFinding,
  type HtmlValidationReport,
} from "./html-validator.js";

export type HtmlValidationDecisionFinding = {
  code: string;
  block_id?: string;
  reason: string;
  evidence?: string;
  suggestion: string;
};

export type HtmlValidationDecision = {
  ok: boolean;
  content_sha256: string;
  errors: HtmlValidationDecisionFinding[];
  advisories: HtmlValidationDecisionFinding[];
};

function compactFindings(findings: HtmlValidationFinding[]): HtmlValidationDecisionFinding[] {
  const compact = new Map<string, HtmlValidationDecisionFinding>();
  for (const finding of findings) {
    const evidence = finding.evidence?.excerpt || finding.selector;
    const value = {
      code: finding.code,
      ...(finding.block_id ? { block_id: finding.block_id } : {}),
      reason: finding.message,
      ...(evidence ? { evidence } : {}),
      suggestion: finding.suggestion,
    };
    compact.set(`${value.block_id ?? ""}\u0000${value.code}\u0000${value.reason}`, value);
  }
  return [...compact.values()];
}

function createHtmlValidationDecision(report: HtmlValidationReport): HtmlValidationDecision {
  const errors = compactFindings(report.findings.filter((finding) => finding.actionable));
  const advisories = compactFindings(
    report.findings.filter((finding) => finding.source === "model" && !finding.actionable),
  );
  return {
    ok: errors.length === 0,
    content_sha256: report.content_sha256,
    errors,
    advisories,
  };
}

export type HtmlValidationStage =
  | { phase: "deterministic_validation" }
  | { phase: "content_review" }
  | { phase: "completed"; decision: HtmlValidationDecision };

export async function* validateStoredArtifact(input: {
  userId: string;
  documentId: string;
  provider: ChatProvider;
  abortSignal?: AbortSignal;
}): AsyncGenerator<HtmlValidationStage> {
  yield { phase: "deterministic_validation" };
  const source = await getDocumentSource(input.userId, input.documentId);
  if (source.mimeType !== "text/html") {
    throw new RequestError("html validation only supports text/html documents");
  }
  const staticReport = validateArtifactHtml(new TextDecoder().decode(source.bytes));
  if (!staticReport.ok) {
    yield { phase: "completed", decision: createHtmlValidationDecision(staticReport) };
    return;
  }
  yield { phase: "content_review" };
  try {
    const reviewedReport = await reviewArtifactHtml({
      userId: input.userId,
      provider: input.provider,
      documentId: input.documentId,
      staticReport,
      abortSignal: input.abortSignal,
    });
    yield { phase: "completed", decision: createHtmlValidationDecision(reviewedReport) };
  } catch (error) {
    if (input.abortSignal?.aborted) throw error;
    logger.warn({ error, documentId: input.documentId }, "non-blocking HTML content review unavailable");
    yield { phase: "completed", decision: createHtmlValidationDecision(staticReport) };
  }
}
