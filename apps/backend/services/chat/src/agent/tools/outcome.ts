import { TransportError } from "@backend/transport-ts";
import { z } from "zod";

import { AgentRunCancelledError } from "../../lib/errors.js";

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_DETAIL_STRING_LENGTH = 2_000;
const REDACTED_KEY = /authorization|api[_-]?key|token|secret|cookie|credential/i;

export const toolIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  retryable: z.boolean(),
  source: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ToolIssue = z.infer<typeof toolIssueSchema>;

export class ToolBlockedError extends Error {
  constructor(readonly issue: ToolIssue) {
    super(issue.message);
    this.name = "ToolBlockedError";
  }
}

export type ToolOutcome<TData = unknown, TProgress = unknown> =
  | { ok: true; status: "running"; progress: TProgress }
  | { ok: true; status: "completed"; data: TData; warnings?: ToolIssue[] }
  | { ok: false; status: "partial"; data: TData; error: ToolIssue }
  | { ok: false; status: "blocked" | "failed"; error: ToolIssue };

const emissionMarker = Symbol("agent-tool-emission");

export type ToolEmission<TData = unknown, TProgress = unknown> =
  | { readonly [emissionMarker]: true; status: "running"; progress: TProgress }
  | { readonly [emissionMarker]: true; status: "completed"; data: TData; warnings?: ToolIssue[] }
  | { readonly [emissionMarker]: true; status: "partial"; data: TData; error: ToolIssue }
  | { readonly [emissionMarker]: true; status: "blocked" | "failed"; error: ToolIssue };

function emission<T extends Omit<ToolEmission, typeof emissionMarker>>(value: T): T & {
  readonly [emissionMarker]: true;
} {
  return Object.assign(value, { [emissionMarker]: true as const });
}

export function toolRunning<TProgress>(progress: TProgress): ToolEmission<never, TProgress> {
  return emission({ status: "running", progress });
}

export function toolCompleted<TData>(data: TData, warnings?: ToolIssue[]): ToolEmission<TData> {
  return emission({ status: "completed", data, ...(warnings?.length ? { warnings } : {}) });
}

export function toolPartial<TData>(data: TData, error: ToolIssue): ToolEmission<TData> {
  return emission({ status: "partial", data, error });
}

export function toolBlocked(error: ToolIssue): ToolEmission<never> {
  return emission({ status: "blocked", error });
}

export function toolFailed(error: ToolIssue): ToolEmission<never> {
  return emission({ status: "failed", error });
}

export function isToolEmission(value: unknown): value is ToolEmission {
  return Boolean(value && typeof value === "object" && emissionMarker in value);
}

export function isToolOutcome(value: unknown): value is ToolOutcome {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "running") {
    return candidate.ok === true && "progress" in candidate;
  }
  if (candidate.status === "completed") {
    return candidate.ok === true && "data" in candidate;
  }
  if (candidate.status === "partial") {
    return candidate.ok === false && "data" in candidate && toolIssueSchema.safeParse(candidate.error).success;
  }
  if (candidate.status === "blocked" || candidate.status === "failed") {
    return candidate.ok === false && toolIssueSchema.safeParse(candidate.error).success;
  }
  return false;
}

export function toolOutcomeData(value: unknown): unknown {
  if (!isToolOutcome(value)) return undefined;
  return value.status === "completed" || value.status === "partial" ? value.data : undefined;
}

export function toolOutcomeSchema<TData, TProgress>(
  dataSchema: z.ZodType<TData>,
  progressSchema: z.ZodType<TProgress> = z.unknown() as z.ZodType<TProgress>,
) {
  return z.discriminatedUnion("status", [
    z.object({ ok: z.literal(true), status: z.literal("running"), progress: progressSchema }),
    z.object({
      ok: z.literal(true),
      status: z.literal("completed"),
      data: dataSchema,
      warnings: z.array(toolIssueSchema).optional(),
    }),
    z.object({
      ok: z.literal(false),
      status: z.literal("partial"),
      data: dataSchema,
      error: toolIssueSchema,
    }),
    z.object({ ok: z.literal(false), status: z.literal("blocked"), error: toolIssueSchema }),
    z.object({ ok: z.literal(false), status: z.literal("failed"), error: toolIssueSchema }),
  ]);
}

function safeDetail(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value.slice(0, MAX_DETAIL_STRING_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeDetail(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !REDACTED_KEY.test(key))
        .slice(0, 50)
        .map(([key, item]) => [key, safeDetail(item, depth + 1)]),
    );
  }
  return String(value).slice(0, MAX_DETAIL_STRING_LENGTH);
}

function detailMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = body as Record<string, unknown>;
  const detail = value.detail;
  if (detail && typeof detail === "object") {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof detail === "string") return detail;
  for (const key of ["message", "error", "title"]) {
    if (typeof value[key] === "string") return value[key] as string;
  }
  return undefined;
}

function codeFromStatus(status: number): string {
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status === 401 || status === 403) return "SERVICE_PERMISSION_DENIED";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 409) return "SERVICE_CONFLICT";
  if (status === 422 || status === 400) return "SERVICE_VALIDATION_FAILED";
  if (status >= 500) return "SERVICE_UNAVAILABLE";
  return "SERVICE_REQUEST_FAILED";
}

export function normalizeToolIssue(
  error: unknown,
  context: { source?: string; code?: string; message?: string; details?: Record<string, unknown> } = {},
): ToolIssue {
  if (error && typeof error === "object" && toolIssueSchema.safeParse(error).success) {
    return toolIssueSchema.parse(error);
  }
  if (error instanceof TransportError) {
    const message = detailMessage(error.body) ?? context.message ?? error.message;
    return {
      code: context.code ?? codeFromStatus(error.status),
      message: message.slice(0, MAX_MESSAGE_LENGTH),
      retryable: error.status === 429 || error.status >= 500,
      source: context.source ?? error.service,
      details: safeDetail({
        status_code: error.status,
        body: error.body,
        ...context.details,
      }) as Record<string, unknown>,
    };
  }
  if (error instanceof Error) {
    const statusCode = "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
    const code = "code" in error && typeof error.code === "string"
      ? error.code.toUpperCase()
      : undefined;
    return {
      code: context.code ?? code ?? "TOOL_EXECUTION_FAILED",
      message: (context.message ?? error.message ?? error.name).slice(0, MAX_MESSAGE_LENGTH),
      retryable: statusCode === 429 || (statusCode != null && statusCode >= 500),
      ...(context.source ? { source: context.source } : {}),
      ...((context.details || ("details" in error && error.details))
        ? { details: safeDetail({ ...(("details" in error && typeof error.details === "object" ? error.details : {}) as object), ...context.details }) as Record<string, unknown> }
        : {}),
    };
  }
  let message: string;
  try {
    message = JSON.stringify(safeDetail(error));
  } catch {
    message = `non-Error value of type ${typeof error}`;
  }
  return {
    code: context.code ?? "TOOL_EXECUTION_FAILED",
    message: (context.message ?? message).slice(0, MAX_MESSAGE_LENGTH),
    retryable: false,
    ...(context.source ? { source: context.source } : {}),
    ...(context.details ? { details: safeDetail(context.details) as Record<string, unknown> } : {}),
  };
}

export function shouldRethrowToolError(error: unknown, abortSignal?: AbortSignal): boolean {
  return (
    abortSignal?.aborted === true ||
    error instanceof AgentRunCancelledError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function outcomeFromEmission<TData, TProgress>(
  value: ToolEmission<TData, TProgress>,
): ToolOutcome<TData, TProgress> {
  if (value.status === "running") return { ok: true, status: "running", progress: value.progress };
  if (value.status === "completed") {
    return { ok: true, status: "completed", data: value.data, ...(value.warnings?.length ? { warnings: value.warnings } : {}) };
  }
  if (value.status === "partial") {
    return { ok: false, status: "partial", data: value.data, error: value.error };
  }
  return { ok: false, status: value.status, error: value.error };
}
