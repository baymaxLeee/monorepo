import { finalizeConversationContext, type ContextEstimate } from "../context/context-snapshot.js";
import {
  finishAgentRun,
  finishAgentStep,
  recordAgentStepContextSnapshot,
  recordToolCallFinish,
  recordToolCallStart,
  startAgentStep,
} from "../runs/repository.js";
import { isToolOutcome } from "../tools/outcome.js";

function stepId(runId: string, stepNumber: number): string {
  const compact = runId
    .replace(/[^a-f0-9]/gi, "")
    .padEnd(30, "0")
    .slice(0, 30);
  return `${compact}${stepNumber.toString(16).padStart(2, "0").slice(-2)}`;
}

export async function startModelStep(input: { runId: string; stepNumber: number; model: string }): Promise<void> {
  await startAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    runId: input.runId,
    stepIndex: input.stepNumber,
    kind: "model",
    summary: "model step started",
    metadata: { model: input.model },
  });
}

export interface UsageTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export const EMPTY_USAGE: UsageTokens = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
};

export async function captureModelStepContext(input: {
  runId: string;
  stepNumber: number;
  contextEstimate: ContextEstimate;
}): Promise<void> {
  const snapshot = finalizeConversationContext(input.contextEstimate, EMPTY_USAGE);
  if (!snapshot) {
    return;
  }
  await recordAgentStepContextSnapshot(stepId(input.runId, input.stepNumber), snapshot);
}

function addToken(left: number | null, right: number | null): number | null {
  if (left == null && right == null) {
    return null;
  }
  return (left ?? 0) + (right ?? 0);
}

export function addUsage(left: UsageTokens, right: UsageTokens): UsageTokens {
  return {
    inputTokens: addToken(left.inputTokens, right.inputTokens),
    outputTokens: addToken(left.outputTokens, right.outputTokens),
    cachedInputTokens: addToken(left.cachedInputTokens, right.cachedInputTokens),
    reasoningTokens: addToken(left.reasoningTokens, right.reasoningTokens),
    totalTokens: addToken(left.totalTokens, right.totalTokens),
  };
}

/** Flatten AI SDK `LanguageModelUsage` (step `event.usage` or run `result.totalUsage`,
 *  same shape) into the billable columns we persist. Cache-hit input and reasoning
 *  output live in the nested `*Details` objects; everything else is top-level. */
export function extractUsageTokens(usage: unknown): UsageTokens {
  const source = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const inputDetails = source.inputTokenDetails as { cacheReadTokens?: unknown } | undefined;
  const outputDetails = source.outputTokenDetails as { reasoningTokens?: unknown } | undefined;
  const token = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    inputTokens: token(source.inputTokens),
    outputTokens: token(source.outputTokens),
    cachedInputTokens: token(inputDetails?.cacheReadTokens),
    reasoningTokens: token(outputDetails?.reasoningTokens),
    totalTokens: token(source.totalTokens),
  };
}

export async function finishModelStep(input: {
  runId: string;
  stepNumber: number;
  finishReason: string;
  usage: unknown;
  toolCallCount: number;
  performance?: unknown;
  response?: unknown;
  providerMetadata?: unknown;
  responseId?: string | null;
  parentResponseId?: string | null;
  contextEstimate?: ContextEstimate;
}): Promise<void> {
  const tokens = extractUsageTokens(input.usage);
  const contextSnapshot = finalizeConversationContext(input.contextEstimate, tokens);
  // Cache/reasoning breakdown is not promoted to step columns: the full usage
  // (incl. inputTokenDetails/outputTokenDetails) is kept in metadata.usage, and
  // billing aggregates at the run level, not per step.
  await finishAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    status: "completed",
    summary: `finish reason: ${input.finishReason}`,
    metadata: {
      usage: input.usage,
      tool_call_count: input.toolCallCount,
      performance: input.performance,
      response: input.response,
      provider_metadata: input.providerMetadata,
      response_id: input.responseId,
      parent_response_id: input.parentResponseId,
      ...(contextSnapshot ? { context_snapshot: contextSnapshot } : {}),
    },
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
  });
}

function sanitizeToolInput(toolName: string, input: unknown): unknown {
  const truncate = (value: string) =>
    value.length <= 400 ? value : `${value.slice(0, 400).trimEnd()}\n...[truncated ${value.length} chars]`;
  if (typeof input === "string") {
    return truncate(input);
  }
  if (typeof input !== "object" || input == null) {
    return input;
  }
  const source = input as Record<string, unknown>;
  if (toolName === "write_file" && typeof source.content === "string") {
    return { ...source, content: truncate(source.content) };
  }
  if (toolName === "edit_file" && Array.isArray(source.edits)) {
    return {
      ...source,
      edits: source.edits.slice(0, 100).map((edit) => {
        if (!edit || typeof edit !== "object") {
          return edit;
        }
        const item = edit as Record<string, unknown>;
        return {
          ...item,
          ...(typeof item.old_text === "string" ? { old_text: truncate(item.old_text) } : {}),
          ...(typeof item.new_text === "string" ? { new_text: truncate(item.new_text) } : {}),
        };
      }),
    };
  }
  return input;
}

export async function recordToolStart(input: {
  runId: string;
  toolCallId: string;
  stepNumber: number;
  toolName: string;
  toolInput: unknown;
}): Promise<void> {
  await recordToolCallStart({
    runId: input.runId,
    toolCallId: input.toolCallId,
    stepIndex: input.stepNumber,
    toolName: input.toolName,
    toolInput: sanitizeToolInput(input.toolName, input.toolInput),
  });
}

export async function recordToolEnd(input: {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output?: unknown;
  error?: unknown;
  durationMs: number;
}): Promise<void> {
  const outcome = isToolOutcome(input.output) ? input.output : null;
  const semanticFailure = input.success && outcome?.ok === false;
  const success = input.success && !semanticFailure;
  await recordToolCallFinish({
    toolCallId: input.toolCallId,
    status: success ? "completed" : "failed",
    output: input.success ? input.output : undefined,
    error: success
      ? undefined
      : (input.error ?? (outcome && outcome.ok === false ? outcome.error.message : input.output)),
    durationMs: Math.max(0, Math.round(input.durationMs)),
  });
}

export async function recordRejectedToolCall(input: {
  runId: string;
  toolCallId: string;
  stepNumber: number;
  toolName: string;
  toolInput: unknown;
  code: "INVALID_TOOL_INPUT" | "NO_SUCH_TOOL";
  error: unknown;
}): Promise<void> {
  await recordToolStart({
    runId: input.runId,
    toolCallId: input.toolCallId,
    stepNumber: input.stepNumber,
    toolName: input.toolName,
    toolInput: input.toolInput,
  });
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await recordToolCallFinish({
    toolCallId: input.toolCallId,
    status: "failed",
    error: `${input.code}: ${message}`.slice(0, 2_000),
    durationMs: 0,
  });
}

export async function failAgentRun(input: { runId: string; error: unknown; usage?: UsageTokens }): Promise<void> {
  await finishAgentRun({
    runId: input.runId,
    status: "failed",
    error: input.error,
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    cachedInputTokens: input.usage?.cachedInputTokens,
    reasoningTokens: input.usage?.reasoningTokens,
    totalTokens: input.usage?.totalTokens,
  });
}
