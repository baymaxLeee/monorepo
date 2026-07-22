import {
  finishAgentRun,
  finishAgentStep,
  recordToolCallFinish,
  recordToolCallStart,
  startAgentStep,
} from "../runs/repository.js";
import { isToolOutcome } from "../tools/outcome.js";

function stepId(runId: string, stepNumber: number): string {
  const compact = runId.replace(/[^a-f0-9]/gi, "").padEnd(30, "0").slice(0, 30);
  return `${compact}${stepNumber.toString(16).padStart(2, "0").slice(-2)}`;
}

export async function startModelStep(input: { runId: string; stepNumber: number; model: string }): Promise<void> {
  await startAgentStep({ stepId: stepId(input.runId, input.stepNumber), runId: input.runId, stepIndex: input.stepNumber, kind: "model", summary: "model step started", metadata: { model: input.model } });
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

function addToken(left: number | null, right: number | null): number | null {
  if (left == null && right == null) return null;
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

export async function finishModelStep(input: { runId: string; stepNumber: number; finishReason: string; usage: unknown; toolCallCount: number; performance?: unknown }): Promise<void> {
  const tokens = extractUsageTokens(input.usage);
  // Cache/reasoning breakdown is not promoted to step columns: the full usage
  // (incl. inputTokenDetails/outputTokenDetails) is kept in metadata.usage, and
  // billing aggregates at the run level, not per step.
  await finishAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    status: "completed",
    summary: `finish reason: ${input.finishReason}`,
    metadata: { usage: input.usage, tool_call_count: input.toolCallCount, performance: input.performance },
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
  });
}

function sanitizeToolInput(toolName: string, input: unknown): unknown {
  if (typeof input !== "object" || input == null) return input;
  const field = toolName === "write_markdown" ? "content" : toolName === "edit_file" ? "brief" : null;
  if (!field) return input;
  const value = (input as Record<string, unknown>)[field];
  if (typeof value !== "string" || value.length <= 400) return input;
  return { ...(input as Record<string, unknown>), [field]: `${value.slice(0, 400).trimEnd()}\n...[truncated ${value.length} chars]` };
}

export async function recordToolStart(input: { runId: string; toolCallId: string; stepNumber: number; toolName: string; toolInput: unknown }): Promise<void> {
  await recordToolCallStart({ runId: input.runId, toolCallId: input.toolCallId, stepIndex: input.stepNumber, toolName: input.toolName, toolInput: sanitizeToolInput(input.toolName, input.toolInput) });
}

export async function recordToolEnd(input: { toolCallId: string; toolName: string; success: boolean; output?: unknown; error?: unknown; durationMs: number }): Promise<void> {
  const outcome = isToolOutcome(input.output) ? input.output : null;
  const semanticFailure = input.success && outcome?.ok === false;
  const success = input.success && !semanticFailure;
  await recordToolCallFinish({
    toolCallId: input.toolCallId,
    status: success ? "completed" : "failed",
    output: input.success ? input.output : undefined,
    error:
      success
        ? undefined
        : input.error ?? (outcome && outcome.ok === false ? outcome.error.message : input.output),
    durationMs: Math.max(0, Math.round(input.durationMs)),
  });
}

export async function failAgentRun(input: {
  runId: string;
  error: unknown;
  usage?: UsageTokens;
}): Promise<void> {
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
