import type { HtmlValidationFinding, HtmlValidationReport } from "./validator.js";

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

export function createHtmlValidationDecision(report: HtmlValidationReport): HtmlValidationDecision {
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
