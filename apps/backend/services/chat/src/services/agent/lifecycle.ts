import {
  finishAgentRun,
  finishAgentStep,
  recordToolCallFinish,
  recordToolCallStart,
  startAgentStep,
} from "./state.js";

function stepId(runId: string, stepNumber: number): string {
  const compact = runId.replace(/[^a-f0-9]/gi, "").padEnd(30, "0").slice(0, 30);
  return `${compact}${stepNumber.toString(16).padStart(2, "0").slice(-2)}`;
}

export async function startModelStep(input: { runId: string; stepNumber: number; model: string }): Promise<void> {
  await startAgentStep({ stepId: stepId(input.runId, input.stepNumber), runId: input.runId, stepIndex: input.stepNumber, kind: "model", summary: "model step started", metadata: { model: input.model } });
}

export async function finishModelStep(input: { runId: string; stepNumber: number; finishReason: string; usage: unknown; toolCallCount: number; performance?: unknown }): Promise<void> {
  const usage = input.usage && typeof input.usage === "object"
    ? input.usage as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown }
    : {};
  const token = (value: unknown) => typeof value === "number" ? value : null;
  await finishAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    status: "completed",
    summary: `finish reason: ${input.finishReason}`,
    metadata: { usage: input.usage, tool_call_count: input.toolCallCount, performance: input.performance },
    inputTokens: token(usage.inputTokens),
    outputTokens: token(usage.outputTokens),
    totalTokens: token(usage.totalTokens),
  });
}

function sanitizeToolInput(toolName: string, input: unknown): unknown {
  if ((toolName !== "write_file" && toolName !== "edit_file") || typeof input !== "object" || input == null || !("brief" in input)) return input;
  const brief = (input as { brief?: unknown }).brief;
  if (typeof brief !== "string" || brief.length <= 400) return input;
  return { ...(input as Record<string, unknown>), brief: `${brief.slice(0, 400).trimEnd()}\n...[truncated ${brief.length} chars]` };
}

export async function recordToolStart(input: { runId: string; toolCallId: string; stepNumber: number; toolName: string; toolInput: unknown }): Promise<void> {
  await recordToolCallStart({ runId: input.runId, toolCallId: input.toolCallId, stepIndex: input.stepNumber, toolName: input.toolName, toolInput: sanitizeToolInput(input.toolName, input.toolInput) });
}

export async function recordToolEnd(input: { toolCallId: string; success: boolean; output?: unknown; error?: unknown; durationMs: number }): Promise<void> {
  const semanticFailure = input.success && typeof input.output === "object" && input.output !== null && "ok" in input.output && (input.output as { ok?: unknown }).ok === false;
  const success = input.success && !semanticFailure;
  await recordToolCallFinish({
    toolCallId: input.toolCallId,
    status: success ? "completed" : "failed",
    output: success ? input.output : undefined,
    error: success ? undefined : input.error ?? input.output,
    durationMs: input.durationMs,
  });
}

export async function failAgentRun(input: { runId: string; error: unknown }): Promise<void> {
  await finishAgentRun({ runId: input.runId, status: "failed", error: input.error });
}
