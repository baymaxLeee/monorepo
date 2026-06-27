import type { WorkflowAgentStreamResult } from "@ai-sdk/workflow";

type AgentStep = WorkflowAgentStreamResult["steps"][number];
type AgentContentPart = AgentStep["content"][number];
type AssistantPart = Record<string, unknown>;

function hydrateToolParts(
  parts: AssistantPart[],
  toolCalls: Array<{ id: string; status: string; output: unknown; error: string | null }>,
): AssistantPart[] {
  const calls = new Map(toolCalls.map((call) => [call.id, call]));
  return parts.map((part) => {
    const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : null;
    if (!toolCallId || !String(part.type ?? "").startsWith("tool-")) return part;
    const call = calls.get(toolCallId);
    if (!call) return part;
    if (call.status === "completed" && call.output !== undefined && call.output !== null) {
      return { ...part, state: "output-available", output: call.output };
    }
    if (call.status === "failed") {
      return { ...part, state: "output-error", errorText: call.error ?? "tool execution failed" };
    }
    return part;
  });
}

function contentPartToAssistantPart(
  part: AgentContentPart,
  results: ReadonlyMap<string, AgentContentPart>,
  errors: ReadonlyMap<string, AgentContentPart>,
): AssistantPart | null {
  switch (part.type) {
    case "text":
      return part.text.trim() ? { type: "text", text: part.text } : null;
    case "reasoning":
      return part.text.trim() ? { type: "reasoning", text: part.text } : null;
    case "source":
      return part.sourceType === "url"
        ? { type: "source-url", sourceId: part.id, url: part.url, title: part.title }
        : null;
    case "tool-call": {
      const error = errors.get(part.toolCallId);
      if (error && "error" in error) {
        return { type: `tool-${part.toolName}`, toolCallId: part.toolCallId, state: "output-error", input: part.input, errorText: String((error as { error: unknown }).error).slice(0, 2000) };
      }
      const result = results.get(part.toolCallId);
      if (result && "output" in result) {
        return { type: `tool-${part.toolName}`, toolCallId: part.toolCallId, state: "output-available", input: part.input, output: (result as { output: unknown }).output };
      }
      return { type: `tool-${part.toolName}`, toolCallId: part.toolCallId, state: "input-available", input: part.input };
    }
    default:
      return null;
  }
}

export function stepsToAssistantParts(steps: readonly AgentStep[]): AssistantPart[] {
  const results = new Map<string, AgentContentPart>();
  const errors = new Map<string, AgentContentPart>();
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === "tool-result") results.set(part.toolCallId, part);
      else if (part.type === "tool-error") errors.set(part.toolCallId, part);
    }
  }
  const parts: AssistantPart[] = [];
  for (const step of steps) {
    for (const part of step.content) {
      const mapped = contentPartToAssistantPart(part, results, errors);
      if (mapped) parts.push(mapped);
    }
  }
  if (!parts.some((part) => part.type === "text")) parts.push({ type: "text", text: "执行完成。" });
  return parts;
}

function stepId(runId: string, stepNumber: number): string {
  const compact = runId.replace(/[^a-f0-9]/gi, "").padEnd(30, "0").slice(0, 30);
  return `${compact}${stepNumber.toString(16).padStart(2, "0").slice(-2)}`;
}

export async function startModelStep(input: { runId: string; stepNumber: number; model: string }): Promise<void> {
  "use step";
  const { startAgentStep } = await import("./agent-state.js");
  await startAgentStep({ stepId: stepId(input.runId, input.stepNumber), runId: input.runId, stepIndex: input.stepNumber, kind: "model", summary: "model step started", metadata: { model: input.model } });
}

export async function finishModelStep(input: { runId: string; stepNumber: number; finishReason: string; usage: unknown; toolCallCount: number; performance?: unknown }): Promise<void> {
  "use step";
  const { finishAgentStep } = await import("./agent-state.js");
  await finishAgentStep({
    stepId: stepId(input.runId, input.stepNumber),
    status: "completed",
    summary: `finish reason: ${input.finishReason}`,
    metadata: { usage: input.usage, tool_call_count: input.toolCallCount, performance: input.performance },
  });
}

function sanitizeToolInput(toolName: string, input: unknown): unknown {
  if ((toolName !== "create_artifact" && toolName !== "update_artifact") || typeof input !== "object" || input == null || !("brief" in input)) return input;
  const brief = (input as { brief?: unknown }).brief;
  if (typeof brief !== "string" || brief.length <= 400) return input;
  return { ...(input as Record<string, unknown>), brief: `${brief.slice(0, 400).trimEnd()}\n...[truncated ${brief.length} chars]` };
}

export async function recordToolStart(input: { runId: string; toolCallId: string; stepNumber: number; toolName: string; toolInput: unknown }): Promise<void> {
  "use step";
  const { recordToolCallStart } = await import("./agent-state.js");
  await recordToolCallStart({ runId: input.runId, toolCallId: input.toolCallId, stepIndex: input.stepNumber, toolName: input.toolName, toolInput: sanitizeToolInput(input.toolName, input.toolInput) });
}

export async function recordToolEnd(input: { toolCallId: string; success: boolean; output?: unknown; error?: unknown; durationMs: number }): Promise<void> {
  "use step";
  const { recordToolCallFinish } = await import("./agent-state.js");
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

export async function persistWorkflowCompletion(input: { runId: string; conversationId: string; parts: AssistantPart[]; totalTokens?: number | null }): Promise<void> {
  "use step";
  const [{ createMessage, touchConversation }, { finishAgentRun, listRunToolCalls }] = await Promise.all([import("./conversations.js"), import("./agent-state.js")]);
  const parts = hydrateToolParts(input.parts, await listRunToolCalls(input.runId));
  const assistant = await createMessage({ conversationId: input.conversationId, role: "assistant", content: JSON.stringify({ version: 1, parts }), status: "ok" });
  await finishAgentRun({ runId: input.runId, status: "completed", outputMessageId: assistant.id, totalTokens: input.totalTokens ?? null });
  await touchConversation(input.conversationId);
}

export async function finishWorkflowStream(writable: WritableStream<unknown>): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write({ type: "finish" });
  } finally {
    writer.releaseLock();
  }
  await writable.close();
}

export async function failWorkflowRun(input: { runId: string; error: unknown }): Promise<void> {
  "use step";
  const { finishAgentRun } = await import("./agent-state.js");
  await finishAgentRun({ runId: input.runId, status: "failed", error: input.error });
}
