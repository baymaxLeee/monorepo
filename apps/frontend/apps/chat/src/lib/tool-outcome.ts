export type ToolIssue = {
  code: string;
  message: string;
  retryable: boolean;
  source?: string;
  details?: Record<string, unknown>;
};

export type ToolOutcome =
  | { ok: true; status: "running"; progress: unknown }
  | { ok: true; status: "completed"; data: unknown; warnings?: ToolIssue[] }
  | { ok: false; status: "partial"; data: unknown; error: ToolIssue }
  | { ok: false; status: "blocked" | "failed"; error: ToolIssue };

function parseIssue(value: unknown): ToolIssue | null {
  if (!value || typeof value !== "object") return null;
  const issue = value as Record<string, unknown>;
  if (
    typeof issue.code !== "string" ||
    typeof issue.message !== "string" ||
    typeof issue.retryable !== "boolean"
  ) {
    return null;
  }
  return {
    code: issue.code,
    message: issue.message,
    retryable: issue.retryable,
    ...(typeof issue.source === "string" ? { source: issue.source } : {}),
    ...(issue.details &&
    typeof issue.details === "object" &&
    !Array.isArray(issue.details)
      ? { details: issue.details as Record<string, unknown> }
      : {}),
  };
}

export function parseToolOutcome(value: unknown): ToolOutcome | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.status === "running" && row.ok === true && "progress" in row) {
    return { ok: true, status: "running", progress: row.progress };
  }
  if (row.status === "completed" && row.ok === true && "data" in row) {
    return { ok: true, status: "completed", data: row.data };
  }
  const issue = parseIssue(row.error);
  if (!issue || row.ok !== false) return null;
  if (row.status === "partial" && "data" in row) {
    return { ok: false, status: "partial", data: row.data, error: issue };
  }
  if (row.status === "blocked" || row.status === "failed") {
    return { ok: false, status: row.status, error: issue };
  }
  return null;
}

export function toolOutcomePayload(outcome: ToolOutcome): unknown {
  if (outcome.status === "running") return outcome.progress;
  if (outcome.status === "completed" || outcome.status === "partial")
    return outcome.data;
  return undefined;
}
